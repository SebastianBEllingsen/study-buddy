import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

// When the app is started from a desktop shortcut, launcher or service
// rather than a terminal, it often inherits a minimal PATH that's missing
// the per-user directories CLI installers put their binaries in — so a CLI
// that works fine in the user's terminal comes back "not on PATH" here.
// These are the common install locations for the supported CLIs (Claude
// Code, Codex) and the package managers used to install them, all derived
// from the current user's home directory / environment at runtime.
export function commonCliDirs(
  platform: NodeJS.Platform,
  home: string,
  env: Env,
  nodeBinDir: string
): string[] {
  if (platform === "win32") {
    const dirs = [path.win32.join(home, ".local", "bin"), nodeBinDir];
    if (env.APPDATA) dirs.push(path.win32.join(env.APPDATA, "npm"));
    if (env.LOCALAPPDATA) dirs.push(path.win32.join(env.LOCALAPPDATA, "pnpm"));
    dirs.push(path.win32.join(home, ".bun", "bin"), path.win32.join(home, ".volta", "bin"));
    return dirs;
  }
  const dirs = [
    // Native installers (Claude Code among them) and pipx.
    path.posix.join(home, ".local", "bin"),
    path.posix.join(home, ".claude", "local"),
    // Global npm installs land next to the running node binary (this also
    // covers version managers like nvm/fnm, whose node isn't system-wide).
    nodeBinDir,
    path.posix.join(home, ".npm-global", "bin"),
    env.PNPM_HOME ?? path.posix.join(home, platform === "darwin" ? "Library/pnpm" : ".local/share/pnpm"),
    path.posix.join(home, ".bun", "bin"),
    path.posix.join(home, ".volta", "bin"),
    path.posix.join(home, "bin"),
    "/usr/local/bin",
  ];
  if (platform === "darwin") dirs.push("/opt/homebrew/bin");
  return dirs;
}

// Returns a copy of env whose PATH also includes commonCliDirs. They're
// appended, never prepended, so anything already on the user's PATH still
// wins; directories already present aren't repeated. Windows env keys are
// case-insensitive and usually spelled "Path", so the existing key is
// reused whatever its casing.
export function withCommonCliDirs(
  env: Env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  nodeBinDir: string = path.dirname(process.execPath)
): Env {
  const isWindows = platform === "win32";
  const pathKey = (isWindows ? Object.keys(env).find((k) => k.toUpperCase() === "PATH") : undefined) ?? "PATH";
  const delimiter = isWindows ? ";" : ":";
  const current = (env[pathKey] ?? "").split(delimiter).filter(Boolean);
  const normalize = (dir: string) => (isWindows ? dir.toLowerCase().replace(/[\\/]+$/, "") : dir.replace(/\/+$/, ""));
  const seen = new Set(current.map(normalize));
  const extra: string[] = [];
  for (const dir of commonCliDirs(platform, home, env, nodeBinDir)) {
    const key = normalize(dir);
    if (!dir || seen.has(key)) continue;
    seen.add(key);
    extra.push(dir);
  }
  return { ...env, [pathKey]: [...current, ...extra].join(delimiter) };
}
