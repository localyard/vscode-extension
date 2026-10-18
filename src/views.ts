// The Projects and Services views in the Localyard sidebar, and the status bar
// item for the open folder's project.

import * as vscode from "vscode";
import { Store } from "./store";
import { Proc, Project, Service } from "./yard";

const PROJECT_ICONS: Record<Project["status"], vscode.ThemeIcon> = {
  running: new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed")),
  starting: new vscode.ThemeIcon("sync~spin"),
  error: new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed")),
  stopped: new vscode.ThemeIcon("circle-large-outline"),
};

function procIcon(p: Proc): vscode.ThemeIcon {
  switch (p.state?.status) {
    case "running":
      return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
    case "restarting":
      return new vscode.ThemeIcon("sync~spin");
    case "crashed":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

function procDescription(p: Proc): string {
  const s = p.state;
  if (!s) return "not started";
  const parts: string[] = [s.status];
  if (s.pid && p.running) parts.push(`pid ${s.pid}`);
  if (s.exit_code !== null && !p.running) parts.push(`exit ${s.exit_code}`);
  if (s.restarts) parts.push(`${s.restarts} restart${s.restarts === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export class ProjectItem extends vscode.TreeItem {
  constructor(readonly project: Project) {
    super(
      project.name,
      project.processes.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `project:${project.path}`;
    this.description = project.url.replace(/^https?:\/\//, "");
    this.tooltip = new vscode.MarkdownString(`**${project.name}** · ${project.status}\n\n${project.url}\n\n\`${project.path}\``);
    this.iconPath = PROJECT_ICONS[project.status] ?? PROJECT_ICONS.stopped;
    this.contextValue = `project.${project.status}`;
  }
}

export class ProcessItem extends vscode.TreeItem {
  constructor(readonly project: Project, readonly proc: Proc) {
    super(proc.name, vscode.TreeItemCollapsibleState.None);
    this.id = `process:${project.path}:${proc.name}`;
    this.description = procDescription(proc);
    this.iconPath = procIcon(proc);
    this.contextValue = `process.${proc.state?.status ?? "none"}`;
    this.command = { command: "localyard.processLogs", title: "Show Logs", arguments: [this] };
  }
}

type ProjectNode = ProjectItem | ProcessItem;

export class ProjectsView implements vscode.TreeDataProvider<ProjectNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: Store) {
    store.onDidChange(() => this.changed.fire());
  }

  getTreeItem(e: ProjectNode): vscode.TreeItem {
    return e;
  }

  getChildren(e?: ProjectNode): ProjectNode[] {
    if (!e) {
      // This window's projects first, then the rest by name.
      const here = new Set(
        (vscode.workspace.workspaceFolders ?? []).map((f) => this.store.projectFor(f.uri.fsPath)?.path),
      );
      return [...this.store.snapshot.projects]
        .sort((a, b) => Number(here.has(b.path)) - Number(here.has(a.path)) || a.name.localeCompare(b.name))
        .map((p) => new ProjectItem(p));
    }
    if (e instanceof ProjectItem) {
      return e.project.processes.map((p) => new ProcessItem(e.project, p));
    }
    return [];
  }
}

export class ServiceItem extends vscode.TreeItem {
  constructor(readonly service: Service) {
    super(service.display_name, vscode.TreeItemCollapsibleState.None);
    this.id = `service:${service.id}`;
    const status = service.status.replace("_", " ");
    this.description = [status, service.version, service.installed ? `:${service.port}` : undefined]
      .filter(Boolean)
      .join(" · ");
    this.tooltip = `${service.display_name}: ${service.description}`;
    this.iconPath =
      service.status === "running"
        ? new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"))
        : service.status === "error"
          ? new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"))
          : service.status === "installing"
            ? new vscode.ThemeIcon("sync~spin")
            : new vscode.ThemeIcon("circle-outline");
    this.contextValue = `service.${service.status}`;
  }
}

export class ServicesView implements vscode.TreeDataProvider<ServiceItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: Store) {
    store.onDidChange(() => this.changed.fire());
  }

  getTreeItem(e: ServiceItem): vscode.TreeItem {
    return e;
  }

  getChildren(e?: ServiceItem): ServiceItem[] {
    if (e) return [];
    // Installed ones first; the list never changes order otherwise.
    return [...this.store.snapshot.services]
      .sort((a, b) => Number(b.installed) - Number(a.installed))
      .map((s) => new ServiceItem(s));
  }
}

/** The open folder's project: `$(icon) name.test`; click for actions. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem("localyard.status", vscode.StatusBarAlignment.Left, 50);
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly store: Store) {
    this.item.name = "Localyard";
    this.subs.push(
      store.onDidChange(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("localyard.statusBar") && this.update()),
    );
    this.update();
  }

  /** The project of the active editor's folder, else the first folder's. */
  current(): Project | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = (uri && vscode.workspace.getWorkspaceFolder(uri)) ?? vscode.workspace.workspaceFolders?.[0];
    return folder && this.store.projectFor(folder.uri.fsPath);
  }

  private update(): void {
    if (!vscode.workspace.getConfiguration("localyard").get<boolean>("statusBar", true)) {
      this.item.hide();
      return;
    }
    if (!this.store.yard) {
      this.item.text = "$(warning) Localyard";
      this.item.tooltip = "The yard command isn't installed. Click to install it.";
      this.item.command = "localyard.installCli";
      this.item.show();
      return;
    }
    const p = this.current();
    if (!p) {
      this.item.hide();
      return;
    }
    const icon = { running: "$(pass-filled)", starting: "$(sync~spin)", error: "$(error)", stopped: "$(circle-large-outline)" }[
      p.status
    ];
    this.item.text = `${icon ?? ""} ${p.url.replace(/^https?:\/\//, "")}`;
    this.item.tooltip = `${p.name} is ${p.status}. Click for actions.`;
    this.item.command = "localyard.projectActions";
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
    this.subs.forEach((s) => s.dispose());
  }
}
