// Live state from `yard events`: it prints a snapshot of every project and
// service, then a new one whenever something changes (it watches Localyard's
// run folder; nothing polls). Views and the status bar listen to `onDidChange`.

import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as readline from "readline";
import * as vscode from "vscode";
import { findYard, Project, run, Snapshot } from "./yard";

const EMPTY: Snapshot = { projects: [], services: [] };
const MAX_RETRY_MS = 30_000;

export class Store implements vscode.Disposable {
  snapshot: Snapshot = EMPTY;
  yard: string | undefined;
  /** This yard predates `yard events`: state is refetched after each action instead. */
  legacy = false;

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private child?: ChildProcess;
  private retryMs = 1000;
  private timer?: NodeJS.Timeout;
  private disposed = false;

  constructor(private readonly log: vscode.OutputChannel) {}

  /** (Re)finds yard and follows its events. */
  start(): void {
    this.stop();
    this.yard = findYard();
    void vscode.commands.executeCommand("setContext", "localyard.cliMissing", !this.yard);
    if (!this.yard) {
      this.set(EMPTY);
      return;
    }
    this.legacy = false;
    // stdin stays open: yard events exits when it closes, i.e. when we go away.
    const child = spawn(this.yard, ["events"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    let stderr = "";
    readline.createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        this.set(JSON.parse(line) as Snapshot);
        this.retryMs = 1000;
      } catch {
        this.log.appendLine(`Unexpected output from yard events: ${line}`);
      }
    });
    child.stderr!.on("data", (d) => (stderr += d));
    child.on("error", (e) => this.log.appendLine(`Could not run ${this.yard}: ${e.message}`));
    child.on("close", (code) => {
      if (this.child !== child || this.disposed) return;
      this.child = undefined;
      if (/unrecognized subcommand/i.test(stderr)) {
        this.legacy = true;
        this.log.appendLine("This yard has no `yard events`; update Localyard for live status.");
        void this.refresh();
        return;
      }
      this.log.appendLine(`yard events stopped (code ${code}); retrying in ${this.retryMs / 1000}s. ${stderr.trim()}`);
      this.timer = setTimeout(() => this.start(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    });
  }

  /** Fetches state once: the Refresh button, and after actions on an older yard. */
  async refresh(): Promise<void> {
    if (!this.legacy || !this.yard) {
      this.start();
      return;
    }
    const [ps, services] = await Promise.all([
      run(this.yard, ["ps", "--all", "--json"], undefined),
      run(this.yard, ["services", "--json"], undefined),
    ]);
    try {
      this.set({ projects: JSON.parse(ps.stdout), services: JSON.parse(services.stdout) });
    } catch {
      this.log.appendLine(`Could not read yard's state: ${ps.stderr}${services.stderr}`);
    }
  }

  /** Called after every action; live state needs nothing. */
  async afterAction(): Promise<void> {
    if (this.legacy) await this.refresh();
  }

  /** The project a workspace folder belongs to, or the one inside it. */
  projectFor(folder: string): Project | undefined {
    const norm = (p: string) => {
      const r = path.resolve(p);
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    const f = norm(folder);
    const within = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
    const projects = this.snapshot.projects;
    // The folder itself or the closest project containing it, then one inside it.
    return (
      projects
        .filter((p) => within(f, norm(p.path)))
        .sort((a, b) => b.path.length - a.path.length)[0] ?? projects.find((p) => within(norm(p.path), f))
    );
  }

  private set(s: Snapshot): void {
    this.snapshot = s;
    void vscode.commands.executeCommand("setContext", "localyard.ready", true);
    this.changed.fire();
  }

  private stop(): void {
    clearTimeout(this.timer);
    const child = this.child;
    this.child = undefined;
    child?.stdin?.end();
    child?.kill();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.changed.dispose();
  }
}
