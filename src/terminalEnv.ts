// Gives new terminals in a project folder what `yard shell` gives: the
// project's runtimes on PATH and its yard.toml [env]. Only in trusted
// folders, since those values come from the repo.

import * as path from "path";
import * as vscode from "vscode";
import { Store } from "./store";
import { EXIT_NOT_A_PROJECT, run } from "./yard";

/** Same list as `yard hook`: variables a shell would run as code. */
const BLOCKED = new Set([
  "PROMPT_COMMAND", "PS0", "PS1", "PS2", "PS3", "PS4", "PROMPT", "RPROMPT", "RPS1", "RPS2", "PROMPT2",
  "BASH_ENV", "ENV", "ZDOTDIR", "SHELLOPTS", "BASHOPTS", "IFS", "CDPATH", "HISTFILE", "HOME", "SHELL",
  "FPATH", "MANPATH", "PYTHONSTARTUP", "PERL5OPT", "RUBYOPT", "NODE_OPTIONS", "GIT_SSH_COMMAND", "EDITOR", "VISUAL",
  "YARD_DIR", "YARD_KEYS", "YARD_OLD_PATH",
]);

function shellSafe(key: string): boolean {
  const k = key.toUpperCase();
  return !BLOCKED.has(k) && !["LD_", "DYLD_", "BASH_FUNC_", "FISH_"].some((p) => k.startsWith(p));
}

export class TerminalEnv implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = [];
  /** What each folder's environment was last built from, to skip no-op refreshes. */
  private readonly seen = new Map<string, string>();

  constructor(private readonly context: vscode.ExtensionContext, private readonly store: Store) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/{yard.toml,yard.local.toml}");
    const force = () => {
      this.seen.clear();
      void this.update();
    };
    this.subs.push(
      watcher,
      watcher.onDidChange(force),
      watcher.onDidCreate(force),
      watcher.onDidDelete(force),
      store.onDidChange(() => void this.update()),
      vscode.workspace.onDidGrantWorkspaceTrust(force),
      vscode.workspace.onDidChangeWorkspaceFolders(force),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("localyard") && force()),
    );
  }

  async update(): Promise<void> {
    const enabled =
      vscode.workspace.isTrusted &&
      vscode.workspace.getConfiguration("localyard").get<boolean>("terminalEnvironment", true);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const env = this.context.environmentVariableCollection.getScoped({ workspaceFolder: folder });
      const project = this.store.projectFor(folder.uri.fsPath);
      const key = JSON.stringify([enabled, this.store.yard, project ?? null]);
      if (this.seen.get(folder.uri.fsPath) === key) continue;
      this.seen.set(folder.uri.fsPath, key);

      if (!enabled || !this.store.yard) {
        env.clear();
        continue;
      }
      const r = await run(this.store.yard, ["env", "--json"], folder.uri.fsPath);
      if (r.code === EXIT_NOT_A_PROJECT) {
        env.clear();
        continue;
      }
      let vars: Record<string, string>;
      try {
        vars = JSON.parse(r.stdout);
      } catch {
        continue; // keep what was there
      }
      env.clear();
      for (const [k, v] of Object.entries(vars)) {
        if (k.toUpperCase() === "PATH") {
          // Only the runtimes Localyard adds, ahead of whatever the shell sets up.
          const have = new Set((process.env.PATH ?? "").split(path.delimiter));
          const added = v.split(path.delimiter).filter((d) => d && !have.has(d));
          if (added.length) env.prepend("PATH", added.join(path.delimiter) + path.delimiter);
        } else if (shellSafe(k) && process.env[k] !== v) {
          env.replace(k, v);
        }
      }
      env.description = new vscode.MarkdownString(
        `Localyard: ${project?.name ?? folder.name}'s runtimes and yard.toml environment`,
      );
    }
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
  }
}
