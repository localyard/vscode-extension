import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { offerInstall } from "./install";
import { Logs } from "./logs";
import { Store } from "./store";
import { TerminalEnv } from "./terminalEnv";
import { ProjectsView, ServicesView, StatusBar } from "./views";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Localyard");
  const store = new Store(log);
  const statusBar = new StatusBar(store);
  const logs = new Logs();
  const terminalEnv = new TerminalEnv(context, store);

  context.subscriptions.push(
    log,
    store,
    statusBar,
    logs,
    terminalEnv,
    vscode.window.registerTreeDataProvider("localyard.projects", new ProjectsView(store)),
    vscode.window.registerTreeDataProvider("localyard.services", new ServicesView(store)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("localyard.yardPath")) store.start();
    }),
  );
  registerCommands(context, store, statusBar, logs, log);

  store.start();
  void offerInstall(context, store, log);
}

export function deactivate(): void {}
