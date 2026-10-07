import { spawn } from "node:child_process";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { ProcessResult } from "./types";

// Runs a compiler or a learner's program on this machine — server side only.
//
// This executes native code, and the tests and reference solutions it runs
// were written by an AI that had read the learner's uploaded material, so
// nothing runs bare: every process is inside bubblewrap (no network, no
// home directory, no other processes, a throwaway /tmp, and only the work
// folder writable) with a wall-clock limit and a CPU limit. If bubblewrap
// isn't installed nothing runs — there is deliberately no unsandboxed
// fallback. Used by the C++, SQL and C# runners.
//
// Only call this for a localhost-only app: the route that wraps it refuses
// requests that don't come from the app's own origin (runRequest.ts).

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT = 2;

export function onPath(program: string): boolean {
  return (process.env.PATH ?? "")
    .split(":")
    .concat(["/usr/sbin", "/usr/bin", "/bin"])
    .some((dir) => dir && existsSync(join(dir, program)));
}

// bubblewrap and prlimit are what every runner needs; each runner adds its
// own compiler or interpreter.
export function sandboxAvailable(): boolean {
  return onPath("bwrap") && onPath("prlimit");
}

// The host directories compilers and programs need, read-only. On a
// merged-/usr system /bin, /lib and friends are symlinks into /usr, which
// are recreated as symlinks rather than bound.
function hostMountArgs(extraReadOnly: string[]): string[] {
  const args: string[] = [];
  for (const path of ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/lib32", ...extraReadOnly]) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) args.push("--symlink", readlinkSync(path), path);
    else if (stat.isDirectory()) args.push("--ro-bind", path, path);
  }
  for (const file of ["/etc/ld.so.cache", "/etc/alternatives"]) {
    if (existsSync(file)) args.push("--ro-bind", file, file);
  }
  return args;
}

export interface SandboxOptions {
  // KEY=VALUE pairs for the process (the environment is otherwise empty).
  env?: string[];
  // Extra host directories to expose read-only (e.g. a .NET install outside /usr).
  readOnly?: string[];
}

export function sandboxArgs(workDir: string, command: string[], options: SandboxOptions = {}): string[] {
  return [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    ...hostMountArgs(options.readOnly ?? []),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    workDir,
    "/work",
    "--chdir",
    "/work",
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/bin:/usr/sbin",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "HOME",
    "/tmp",
    ...(options.env ?? []).flatMap((pair) => ["--setenv", pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
    "prlimit",
    "--cpu=10",
    "--fsize=5000000",
    "--nofile=256",
    "--core=0",
    ...command,
  ];
}

export function runSandboxed(
  workDir: string,
  command: string[],
  timeoutMs: number,
  options: SandboxOptions = {}
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout takes the whole tree with it.
    const child = spawn("bwrap", sandboxArgs(workDir, command, options), { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const take = (current: string, chunk: Buffer) =>
      current.length >= MAX_OUTPUT_BYTES ? current : current + chunk.toString("utf8").slice(0, MAX_OUTPUT_BYTES);
    child.stdout.on("data", (chunk: Buffer) => (stdout = take(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = take(stderr, chunk)));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, timedOut: false, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut, stdout, stderr });
    });
  });
}

// At most MAX_CONCURRENT runs at once across every language: each is a
// compiler or interpreter plus the learner's program.
let active = 0;
const waiting: (() => void)[] = [];
export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
