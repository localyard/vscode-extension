// Finding and running the `yard` command. Everything the extension knows
// comes from it: `yard events` for live state, the other commands for actions.

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export type ProjectStatus = "running" | "stopped" | "error" | "starting";
export type ProcStatus = "running" | "restarting" | "stopped" | "exited" | "crashed";
export type ServiceStatus = "running" | "stopped" | "error" | "installing" | "not_installed";

export interface Proc {
  project: string;
  name: string;
  running: boolean;
  state: { status: ProcStatus; pid: number | null; exit_code: number | null; restarts: number } | null;
}

export interface Project {
  name: string;
  url: string;
  status: ProjectStatus;
  path: string;
  processes: Proc[];
}

export interface Service {
  id: string;
  display_name: string;
  description: string;
  port: number;
  status: ServiceStatus;
  version: string | null;
  pid: number | null;
  installed: boolean;
}

/** One line of `yard events`. */
export interface Snapshot {
  projects: Project[];
  services: Service[];
}

const exe = process.platform === "win32" ? "yard.exe" : "yard";

/** Where the app's "Install yard command" and install.sh both put it. */
export const defaultInstallPath = path.join(os.homedir(), ".localyard", "bin", exe);

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The `yard` binary: the setting, then PATH, then ~/.localyard/bin. */
export function findYard(): string | undefined {
  const configured = vscode.workspace.getConfiguration("localyard").get<string>("yardPath")?.trim();
  if (configured) {
    return isFile(configured) ? configured : undefined;
  }
  // Apps opened from the Dock don't get the shell's PATH, hence the fallback.
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && isFile(path.join(dir, exe))) {
      return path.join(dir, exe);
    }
  }
  return isFile(defaultInstallPath) ? defaultInstallPath : undefined;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const ansi = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ansi, "");
}

/** Runs `yard args` in `cwd`; `onLine` gets each stderr line (progress) as it arrives. */
export function run(
  yard: string,
  args: string[],
  cwd: string | undefined,
  onLine?: (line: string) => void,
  token?: vscode.CancellationToken,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(yard, args, { cwd, env: { ...process.env, NO_COLOR: "1" } });
    let stdout = "";
    let stderr = "";
    let partial = "";
    token?.onCancellationRequested(() => child.kill());
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      const text = stripAnsi(String(d));
      stderr += text;
      // Progress lines end in \n, download bars in \r.
      const lines = (partial + text).split(/\r?\n|\r/);
      partial = lines.pop() ?? "";
      for (const l of lines) {
        if (l.trim()) onLine?.(l);
      }
    });
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + e.message }));
    child.on("close", (code) => {
      if (partial.trim()) onLine?.(partial);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** The error `yard --json` printed, else the last stderr lines. */
export function errorText(r: RunResult): string {
  for (const line of r.stdout.split("\n").reverse()) {
    try {
      const v = JSON.parse(line);
      if (typeof v?.error === "string") return v.error;
    } catch {
      // not JSON
    }
  }
  const tail = r.stderr.trim().split("\n").slice(-3).join(" ").replace(/^error:\s*/, "");
  return tail || `yard exited with code ${r.code}`;
}

/** Exit code for "this folder isn't a Localyard project". */
export const EXIT_NOT_A_PROJECT = 3;
