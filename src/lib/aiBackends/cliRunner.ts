import { spawn } from "node:child_process";

export class CliNotFoundError extends Error {}
export class CliTimeoutError extends Error {}

export interface RunCliParams {
  command: string;
  /**
   * Must be a fixed, code-controlled list — never interpolate untrusted
   * content (PDF text, user-typed names, etc.) into args. On Windows this
   * runs with shell:true (required to launch npm's .cmd/.bat shims — see
   * below), and shell:true is only safe when args can never carry shell
   * metacharacters from untrusted input. Put all variable/untrusted content
   * in `stdin` instead.
   */
  args: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBufferBytes: number;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
}

// On Windows, shell:true (needed for .cmd/.bat shims) means a missing
// command never reaches child_process's own "error"/ENOENT path — cmd.exe
// itself launches fine, then prints this to stderr and exits non-zero, which
// otherwise surfaces as a raw, ugly OS error message instead of a clean
// CliNotFoundError. POSIX shells covered too for robustness, even though
// shell is only true on win32 today.
const COMMAND_NOT_FOUND_PATTERNS =
  /is not recognized as an internal or external command|command not found|no such file or directory/i;

// With shell:true, Node passes [command, ...args] to cmd.exe as ONE joined
// string, and — unlike a normal non-shell spawn — does NOT auto-quote args
// containing spaces first. Without this, a multi-word arg (e.g. our own
// authored instruction sentence) gets word-split by cmd.exe's own re-parsing
// before the target CLI ever sees it (confirmed empirically: "Follow the
// SYSTEM..." arrived as separate args "Follow", "the", "SYSTEM", ... and the
// CLI tried to parse "the" as a subcommand). Every arg here is always a
// fixed, code-controlled token (a flag name or our own sentence) — never
// untrusted content, which goes via stdin instead — so a plain
// wrap-if-it-contains-whitespace is enough; nothing we pass ever contains a
// literal quote or other cmd.exe metacharacter to worry about.
function quoteForWindowsShell(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/**
 * Runs a local CLI (Claude Code, Codex, ...) cross-platform. On Windows,
 * npm-installed global CLIs are typically `.cmd`/`.bat` shims, which
 * Node's child_process cannot launch without shell:true (Node's own docs:
 * ".bat and .cmd files ... cannot be launched using child_process.execFile()").
 * shell:true is normally a shell-injection risk when args carry untrusted
 * content — the fix here is architectural, not a Windows-only escape hatch:
 * `args` must always be a fixed set of flags we author ourselves, and every
 * piece of variable/untrusted content goes through stdin, which the shell
 * never re-parses.
 */
export function runCli(params: RunCliParams): Promise<RunCliResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const child = spawn(
      params.command,
      isWindows ? params.args.map(quoteForWindowsShell) : params.args,
      {
        cwd: params.cwd,
        env: params.env,
        shell: isWindows,
      }
    );

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let settled = false;

    function finish(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(new CliTimeoutError(`${params.command} timed out after ${params.timeoutMs}ms`));
      });
    }, params.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > params.maxBufferBytes) {
        finish(() => {
          child.kill();
          reject(new Error(`${params.command} output exceeded ${params.maxBufferBytes} bytes`));
        });
        return;
      }
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() => {
        if (err.code === "ENOENT") {
          reject(new CliNotFoundError(`${params.command} isn't on PATH`));
        } else {
          reject(err);
        }
      });
    });

    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          const message = stderr.trim() || `${params.command} exited with code ${code}`;
          if (COMMAND_NOT_FOUND_PATTERNS.test(message) || COMMAND_NOT_FOUND_PATTERNS.test(stdout)) {
            reject(new CliNotFoundError(`${params.command} isn't on PATH`));
            return;
          }
          reject(new Error(message));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    // child.stdin is its own stream, separate from the child process object
    // — the child.on("error"/"close") handlers above don't cover a failure
    // writing to it (e.g. the spawn itself failing with ENOENT, or the
    // child exiting before consuming a large prompt, either of which can
    // leave this pipe destroyed/closed). Without a listener here, that
    // becomes an unhandled 'error' event on the stream, which crashes the
    // process rather than surfacing as the CliNotFoundError/rejection those
    // other handlers already produce.
    // child.stdin is its own stream, separate from the child process object
    // — the child.on("error"/"close") handlers above don't cover a failure
    // writing to it (e.g. the spawn itself failing with ENOENT, or the
    // child exiting before consuming a large prompt, either of which can
    // leave this pipe destroyed/closed). Without a listener here, that
    // becomes an unhandled 'error' event on the stream, which crashes the
    // process rather than surfacing as the CliNotFoundError/rejection those
    // other handlers already produce.
    child.stdin.on("error", () => {});
    child.stdin.write(params.stdin, "utf-8");
    child.stdin.end();
  });
}
