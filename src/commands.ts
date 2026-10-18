// Every Localyard command: they run `yard` in the project's folder and report
// progress in a notification. State updates arrive through `yard events`.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { installCli } from "./install";
import { Logs } from "./logs";
import { Store } from "./store";
import { ProcessItem, ProjectItem, ServiceItem, StatusBar } from "./views";
import { errorText, Project, run } from "./yard";

/** What a project command acts on: a known project, or a folder with a yard.toml not started yet. */
interface Target {
  cwd: string;
  name: string;
  project?: Project;
}

const PHP_VERSIONS = ["8.5", "8.4", "8.3", "8.2", "8.1"];
const NODE_VERSIONS = ["24", "22", "20", "18"];

export function registerCommands(
  context: vscode.ExtensionContext,
  store: Store,
  statusBar: StatusBar,
  logs: Logs,
  log: vscode.OutputChannel,
): void {
  const yardOrOffer = (): string | undefined => {
    if (store.yard) return store.yard;
    void vscode.window
      .showWarningMessage("The yard command isn't installed.", "Install yard")
      .then((c) => c && installCli(store, log));
    return undefined;
  };

  /** Runs `yard args --json` with a progress notification; true on success. */
  const action = async (title: string, args: string[], cwd?: string): Promise<boolean> => {
    const yard = yardOrOffer();
    if (!yard) return false;
    log.appendLine(`\n$ yard ${args.join(" ")}${cwd ? `  (in ${cwd})` : ""}`);
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (progress, token) =>
        run(
          yard,
          [...args, "--json"],
          cwd,
          (line) => {
            log.appendLine(line);
            progress.report({ message: line.length > 120 ? line.slice(0, 117) + "..." : line });
          },
          token,
        ),
    );
    await store.afterAction();
    if (r.code === 0) return true;
    const choice = await vscode.window.showErrorMessage(`${title} failed: ${errorText(r)}`, "Show Output");
    if (choice) log.show();
    return false;
  };

  const requireTrust = (what: string): boolean => {
    if (vscode.workspace.isTrusted) return true;
    vscode.window.showWarningMessage(`Trust this folder to ${what}: it runs commands from yard.toml.`);
    return false;
  };

  const folderWithManifest = (): vscode.WorkspaceFolder | undefined =>
    vscode.workspace.workspaceFolders?.find((f) => fs.existsSync(path.join(f.uri.fsPath, "yard.toml")));

  /** The clicked item, else the open folder's project, else ask. */
  const target = async (arg?: unknown): Promise<Target | undefined> => {
    if (arg instanceof ProjectItem || arg instanceof ProcessItem) {
      return { cwd: arg.project.path, name: arg.project.name, project: arg.project };
    }
    const current = statusBar.current();
    if (current) return { cwd: current.path, name: current.name, project: current };
    const folder = folderWithManifest();
    if (folder) return { cwd: folder.uri.fsPath, name: folder.name };
    const projects = store.snapshot.projects;
    if (!projects.length) {
      const c = await vscode.window.showInformationMessage("No Localyard project here yet.", "Create yard.toml");
      if (c) await vscode.commands.executeCommand("localyard.init");
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.name, description: p.url, detail: p.path, p })),
      { placeHolder: "Which project?" },
    );
    return pick && { cwd: pick.p.path, name: pick.p.name, project: pick.p };
  };

  const projectOf = (t: Target): Project | undefined =>
    t.project ? store.snapshot.projects.find((p) => p.path === t.project!.path) ?? t.project : store.projectFor(t.cwd);

  const openSite = async (t: Target) => {
    const url = projectOf(t)?.url;
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    else vscode.window.showInformationMessage(`${t.name} has no site yet. Start it first.`);
  };

  const up = async (arg?: unknown) => {
    const t = await target(arg);
    if (!t || !requireTrust("start it")) return;
    if (await action(`Starting ${t.name}`, ["up"], t.cwd)) {
      const url = projectOf(t)?.url;
      const open = await vscode.window.showInformationMessage(`${t.name} is up${url ? ` at ${url}` : ""}.`, "Open Site");
      if (open) await openSite(t);
    }
  };

  const terminal = (name: string, args: string[], cwd?: string) => {
    const yard = yardOrOffer();
    if (!yard) return;
    vscode.window.createTerminal({ name, shellPath: yard, shellArgs: args, cwd, iconPath: new vscode.ThemeIcon("server-environment") }).show();
  };

  const useRuntime = async (arg: unknown, runtime: "php" | "node", versions: string[]) => {
    const t = await target(arg);
    if (!t) return;
    const other = "Other version...";
    let version = await vscode.window.showQuickPick([...versions, other], {
      placeHolder: `${runtime === "php" ? "PHP" : "Node"} version for ${t.name}`,
    });
    if (version === other) {
      version = await vscode.window.showInputBox({ prompt: `${runtime} version, e.g. ${versions[1]}` });
    }
    if (!version) return;
    if (!(await action(`Switching ${t.name} to ${runtime} ${version}`, ["use", runtime, version], t.cwd))) return;
    if (projectOf(t)?.status === "running") {
      const restart = await vscode.window.showInformationMessage(
        `${t.name} now uses ${runtime} ${version}. Restart it to apply this to running processes.`,
        "Restart",
      );
      if (restart && requireTrust("restart it")) await action(`Restarting ${t.name}`, ["restart"], t.cwd);
    }
  };

  const showLogs = async (arg?: unknown) => {
    const t = await target(arg);
    const yard = t && yardOrOffer();
    if (!t || !yard) return;
    const project = projectOf(t);
    if (!project) {
      vscode.window.showInformationMessage(`${t.name} has no logs yet. Start it first.`);
      return;
    }
    const names = project.processes.map((p) => p.name);
    let which: string | undefined;
    if (names.length > 1 || names.length === 0) {
      const pick = await vscode.window.showQuickPick(
        [
          ...(names.length ? [{ label: "All processes", value: "" }] : []),
          ...names.map((n) => ({ label: n, value: n })),
          { label: "Site access log", value: "site" },
        ],
        { placeHolder: `${project.name} logs` },
      );
      if (!pick) return;
      which = pick.value || undefined;
    } else {
      which = names[0];
    }
    logs.show(yard, project, which);
  };

  const service = (verb: string, args: (id: string) => string[]) => async (item?: ServiceItem) => {
    if (!item) return;
    await action(`${verb} ${item.service.display_name}`, args(item.service.id));
  };

  const commands: Record<string, (...args: any[]) => unknown> = {
    "localyard.refresh": () => store.refresh(),
    "localyard.installCli": () => installCli(store, log),
    "localyard.up": up,
    "localyard.down": async (arg?: unknown) => {
      const t = await target(arg);
      if (t) await action(`Stopping ${t.name}`, ["down"], t.cwd);
    },
    "localyard.restart": async (arg?: unknown) => {
      const t = await target(arg);
      if (t && requireTrust("restart it")) await action(`Restarting ${t.name}`, ["restart"], t.cwd);
    },
    "localyard.setup": async (arg?: unknown) => {
      const t = await target(arg);
      if (t && requireTrust("run its setup hooks")) await action(`Running setup for ${t.name}`, ["setup"], t.cwd);
    },
    "localyard.openSite": async (arg?: unknown) => {
      const t = await target(arg);
      if (t) await openSite(t);
    },
    "localyard.share": async (arg?: unknown) => {
      const t = await target(arg);
      if (t) terminal(`Share ${t.name}`, ["share"], t.cwd);
    },
    "localyard.logs": showLogs,
    "localyard.processLogs": (item?: ProcessItem) => {
      const yard = yardOrOffer();
      if (item && yard) logs.show(yard, item.project, item.proc.name);
    },
    "localyard.stopLogs": () => logs.stopAll(),
    "localyard.usePhp": (arg?: unknown) => useRuntime(arg, "php", PHP_VERSIONS),
    "localyard.useNode": (arg?: unknown) => useRuntime(arg, "node", NODE_VERSIONS),
    "localyard.doctor": () => terminal("Localyard Doctor", ["doctor"]),
    "localyard.init": async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const folder =
        folders.length > 1 ? await vscode.window.showWorkspaceFolderPick({ placeHolder: "Create yard.toml in" }) : folders[0];
      if (!folder) {
        vscode.window.showInformationMessage("Open a project folder first.");
        return;
      }
      const file = path.join(folder.uri.fsPath, "yard.toml");
      if (!fs.existsSync(file) && !(await action("Detecting the stack", ["init"], folder.uri.fsPath))) return;
      await vscode.window.showTextDocument(vscode.Uri.file(file));
    },
    "localyard.projectActions": async () => {
      const t = await target();
      if (!t) return;
      const running = ["running", "starting"].includes(projectOf(t)?.status ?? "");
      const items = [
        ...(running
          ? [
              { label: "$(globe) Open Site", cmd: "localyard.openSite" },
              { label: "$(debug-restart) Restart", cmd: "localyard.restart" },
              { label: "$(debug-stop) Stop", cmd: "localyard.down" },
            ]
          : [{ label: "$(play) Start", cmd: "localyard.up" }]),
        { label: "$(output) Show Logs", cmd: "localyard.logs" },
        { label: "$(radio-tower) Share Publicly", cmd: "localyard.share" },
        { label: "$(tools) Run Setup Hooks", cmd: "localyard.setup" },
        { label: "$(versions) Switch PHP Version", cmd: "localyard.usePhp" },
        { label: "$(versions) Switch Node Version", cmd: "localyard.useNode" },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: `${t.name} (${projectOf(t)?.status ?? "not started"})` });
      const p = projectOf(t);
      if (pick) await vscode.commands.executeCommand(pick.cmd, p && new ProjectItem(p));
    },
    "localyard.serviceStart": service("Starting", (id) => ["services", "start", id]),
    "localyard.serviceStop": service("Stopping", (id) => ["services", "stop", id]),
    "localyard.serviceRestart": service("Restarting", (id) => ["services", "restart", id]),
    "localyard.serviceInstall": service("Installing", (id) => ["install", id]),
  };

  for (const [id, fn] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }
}
