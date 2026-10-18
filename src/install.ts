// Getting the `yard` command onto a machine that doesn't have it. macOS and
// Linux run the official install.sh (it puts yard in ~/.localyard/bin);
// Windows gets it from the Localyard app.

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Store } from "./store";
import { stripAnsi } from "./yard";

const INSTALL_SCRIPT = "https://github.com/localyard/localyard/releases/latest/download/install.sh";
export const RELEASES = "https://github.com/localyard/localyard/releases/latest";
const DONT_ASK_KEY = "localyard.dontOfferInstall";

/** Asks once per window when yard is missing, unless told not to. */
export async function offerInstall(context: vscode.ExtensionContext, store: Store, log: vscode.OutputChannel) {
  if (store.yard || context.globalState.get<boolean>(DONT_ASK_KEY)) return;
  const install = process.platform === "win32" ? "Download Localyard" : "Install yard";
  const choice = await vscode.window.showInformationMessage(
    "Localyard needs its `yard` command line tool to run your sites. Install it now?",
    install,
    "Not Now",
    "Don't Ask Again",
  );
  if (choice === install) {
    await installCli(store, log);
  } else if (choice === "Don't Ask Again") {
    await context.globalState.update(DONT_ASK_KEY, true);
  }
}

export async function installCli(store: Store, log: vscode.OutputChannel): Promise<void> {
  store.start();
  if (store.yard) {
    vscode.window.showInformationMessage(`yard is already installed at ${store.yard}.`);
    return;
  }
  if (process.platform === "win32") {
    await vscode.env.openExternal(vscode.Uri.parse(RELEASES));
    const again = await vscode.window.showInformationMessage(
      "Install the Localyard app, then open Settings → yard command → Install yard command.",
      "Check Again",
    );
    if (again) {
      store.start();
      if (!store.yard) vscode.window.showWarningMessage("yard still isn't installed. Set localyard.yardPath if it's somewhere unusual.");
    }
    return;
  }

  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Installing yard", cancellable: true },
    async (progress, token) => {
      progress.report({ message: "downloading the installer..." });
      log.appendLine(`Downloading ${INSTALL_SCRIPT}`);
      let script: string;
      try {
        const res = await fetch(INSTALL_SCRIPT);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        script = await res.text();
      } catch (e) {
        log.appendLine(`Download failed: ${e}`);
        return false;
      }
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localyard-")), "install.sh");
      fs.writeFileSync(file, script, { mode: 0o700 });
      return new Promise<boolean>((resolve) => {
        const child = spawn("sh", [file], { env: { ...process.env, NO_COLOR: "1" } });
        token.onCancellationRequested(() => child.kill());
        const out = (d: Buffer) => {
          const text = stripAnsi(String(d));
          log.append(text);
          const last = text.trim().split("\n").pop();
          if (last) progress.report({ message: last });
        };
        child.stdout.on("data", out);
        child.stderr.on("data", out);
        child.on("error", (e) => {
          log.appendLine(e.message);
          resolve(false);
        });
        child.on("close", (code) => {
          fs.rmSync(path.dirname(file), { recursive: true, force: true });
          resolve(code === 0);
        });
      });
    },
  );

  store.start();
  if (ok && store.yard) {
    vscode.window.showInformationMessage(`yard is installed at ${store.yard}. Localyard is ready.`);
    return;
  }
  const choice = await vscode.window.showErrorMessage(
    "Installing yard didn't finish. You can install the Localyard app instead, which includes it.",
    "Show Output",
    "Download Localyard",
  );
  if (choice === "Show Output") log.show();
  if (choice === "Download Localyard") vscode.env.openExternal(vscode.Uri.parse(RELEASES));
}
