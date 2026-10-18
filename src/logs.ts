// Process logs in Output channels, one per project and process, followed with
// `yard logs -f` until the window closes or "Stop Following Logs".

import { ChildProcess, spawn } from "child_process";
import * as vscode from "vscode";
import { Project, stripAnsi } from "./yard";

interface Follower {
  channel: vscode.OutputChannel;
  child?: ChildProcess;
}

export class Logs implements vscode.Disposable {
  private readonly followers = new Map<string, Follower>();

  /** `process` is a process name, `site` for the access log, or undefined for all. */
  show(yard: string, project: Project, process?: string): void {
    const key = `${project.path}\0${process ?? ""}`;
    let f = this.followers.get(key);
    if (!f) {
      const label = process ? `${project.name} · ${process}` : project.name;
      f = { channel: vscode.window.createOutputChannel(`Localyard: ${label}`) };
      this.followers.set(key, f);
    }
    if (!f.child || f.child.exitCode !== null) {
      this.follow(yard, project, process, f);
    }
    f.channel.show(true);
  }

  private follow(yard: string, project: Project, process: string | undefined, f: Follower): void {
    const args = ["logs", "-f", "-n", "200", ...(process ? [process] : [])];
    const child = spawn(yard, args, { cwd: project.path, env: { ...globalThis.process.env, NO_COLOR: "1" } });
    f.child = child;
    const write = (d: Buffer) => f.channel.append(stripAnsi(String(d)));
    child.stdout.on("data", write);
    child.stderr.on("data", write);
    child.on("error", (e) => f.channel.appendLine(`Could not follow logs: ${e.message}`));
  }

  stopAll(): void {
    for (const f of this.followers.values()) {
      f.child?.kill();
      f.child = undefined;
    }
  }

  dispose(): void {
    this.stopAll();
    for (const f of this.followers.values()) f.channel.dispose();
    this.followers.clear();
  }
}
