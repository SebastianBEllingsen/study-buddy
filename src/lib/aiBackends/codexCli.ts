import os from "node:os";
import { runCli, CliNotFoundError, CliTimeoutError } from "./cliRunner";
import type { GenerateStructuredParams, GenerateTextImage, GenerateTextParams, GenerateWorkspaceScope } from "./types";
import { getAppSettings } from "../models";
import { materializeCliWorkspace } from "./cliWorkspace";
import { stripCodeFences } from "./jsonText";

// Hardening for a subprocess whose prompt embeds untrusted content (uploaded
// PDF text — see the same note in claudeCode.ts). -s read-only denies file
// writes and network access at the OS sandbox level (Seatbelt on macOS,
// bubblewrap on Linux, the native sandbox on Windows). Fixed, hardcoded
// flags — see cliRunner.ts for why that matters on Windows.
//
// No -a/--ask-for-approval here: a real installed `codex exec` rejected it
// ("unexpected argument '-a' found") — that flag exists on `codex`'s
// top-level/interactive command, not on the `exec` subcommand specifically,
// which has no TTY to prompt on anyway and so has nothing to configure
// approval behavior for. Confirmed against the actual error text; not a
// guess like the original flag choice was.
//
// --skip-git-repo-check: codex refuses to run at all outside a trusted
// directory or a git repo ("Not inside a trusted directory and
// --skip-git-repo-check was not specified" — again the real CLI's own
// error text, not guessed). cwd here is a scratch temp dir (see below),
// deliberately neither — this bypasses that specific heuristic only; the
// actual security boundary is the -s read-only sandbox above, which still
// fully applies regardless of cwd.
const HARDENING_ARGS = ["-s", "read-only", "--skip-git-repo-check"];

// Used instead of HARDENING_ARGS when AppSettings.cliTrustedModeEnabled is
// on — "workspace-write" is Codex's own sandbox mode for full read/write/
// exec access confined to the process's cwd (which cliWorkspace.ts always
// sets to a dedicated, disposable directory in this mode — never the real
// project root). NOT hands-on verified against a real installed `codex`
// (none available in this environment, same caveat as the missing --model
// flag below) — confirm this is still the right mode name against a real
// `codex exec --help` before shipping, same discipline as this file's other
// empirically-unverified choices.
const TRUSTED_ARGS = ["-s", "workspace-write", "--skip-git-repo-check"];

// Fixed instruction passed as the prompt argument — never interpolates any
// variable/untrusted content (see cliRunner.ts). The actual system prompt
// and user prompt (which embeds untrusted PDF text) go via stdin instead;
// `codex exec` appends piped stdin to the prompt as a <stdin> block.
const STDIN_INSTRUCTION =
  "Follow the SYSTEM INSTRUCTIONS and respond to the USER REQUEST below, both provided via stdin.";

// Used in place of STDIN_INSTRUCTION when a workspace was actually
// materialized (see cliWorkspace.ts) — points the CLI at manifest.json
// instead of leaving it to guess file locations. Still a fixed string, no
// interpolation of untrusted content.
const STDIN_INSTRUCTION_WITH_WORKSPACE =
  `${STDIN_INSTRUCTION} A manifest.json file in your current working directory ` +
  "lists any course documents and attached images made available for this " +
  "request — read it first to find exact file paths.";

function sanitize(text: string): string {
  return text.replace(/\0/g, "");
}

function buildStdin(systemPrompt: string, userPrompt: string): string {
  return `SYSTEM INSTRUCTIONS:\n${sanitize(systemPrompt)}\n\n---\n\nUSER REQUEST:\n${sanitize(userPrompt)}`;
}

// No --model flag: deliberately relies on the installed Codex CLI's own
// default rather than guessing a specific model id here — verify/adjust at
// implementation time once a real `codex` CLI is available to test against
// (this backend hasn't been hands-on tested in this environment; see the
// plan's verification notes).
async function runCodex(params: {
  userPrompt: string;
  systemPrompt: string;
  cliTrustedModeEnabled: boolean;
  workspaceScope?: GenerateWorkspaceScope;
  images?: GenerateTextImage[];
}): Promise<string> {
  // Only pay for materializing a workspace when trusted mode is on AND
  // there's actually something to put in it — otherwise cwd stays
  // os.tmpdir(), exactly like the untrusted path.
  const hasWorkspaceContent = !!(params.workspaceScope?.documentIds?.length || params.images?.length);
  const useWorkspace = params.cliTrustedModeEnabled && hasWorkspaceContent;

  const workspace = useWorkspace
    ? await materializeCliWorkspace({
        documentIds: params.workspaceScope?.documentIds,
        inlineFiles: params.images?.map((image, i) => ({
          filename: `image-${i + 1}`,
          base64: image.base64,
          mimeType: image.mimeType,
        })),
      })
    : null;

  try {
    const args = [
      "exec",
      ...(params.cliTrustedModeEnabled ? TRUSTED_ARGS : HARDENING_ARGS),
      workspace ? STDIN_INSTRUCTION_WITH_WORKSPACE : STDIN_INSTRUCTION,
    ];

    // Same precaution as claudeCode.ts: an OPENAI_API_KEY in the environment
    // (e.g. set for the OpenAI API backend) could otherwise outrank the
    // Codex CLI's own ChatGPT/subscription login, silently billing per-token
    // instead of using the subscription this backend exists to use.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;

    let stdout: string;
    try {
      ({ stdout } = await runCli({
        command: "codex",
        args,
        stdin: buildStdin(params.systemPrompt, params.userPrompt),
        cwd: workspace?.dir ?? os.tmpdir(),
        env,
        timeoutMs: 5 * 60 * 1000,
        maxBufferBytes: 20 * 1024 * 1024,
      }));
    } catch (err) {
      if (err instanceof CliNotFoundError) {
        throw new Error(
          "The `codex` CLI isn't on PATH — install it, or switch to a different backend."
        );
      }
      throw err;
    }

    // Non-interactive `codex exec` (without --json) prints progress to
    // stderr and only the final agent message to stdout, so no event-stream
    // parsing is needed here.
    return stdout.trim();
  } finally {
    await workspace?.cleanup();
  }
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  const { cliTrustedModeEnabled } = await getAppSettings();
  const raw = await runCodex({
    userPrompt: params.user,
    systemPrompt: params.system,
    cliTrustedModeEnabled,
    workspaceScope: params.workspaceScope,
  });
  try {
    return JSON.parse(stripCodeFences(raw)) as T;
  } catch {
    const retryRaw = await runCodex({
      systemPrompt: params.system,
      cliTrustedModeEnabled,
      workspaceScope: params.workspaceScope,
      userPrompt: `${params.user}\n\nYour previous response was not valid JSON:\n${raw}\n\nRespond again with ONLY the corrected, valid JSON object — no prose, no markdown code fences.`,
    });
    return JSON.parse(stripCodeFences(retryRaw)) as T;
  }
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  const { cliTrustedModeEnabled } = await getAppSettings();
  if (params.images?.length && !cliTrustedModeEnabled) {
    throw new Error(
      "Image input isn't supported with the Codex backend — switch to the Anthropic API, OpenAI, Gemini, or Free backend in Settings, or turn on full tool access for this CLI backend in Settings."
    );
  }
  return runCodex({
    userPrompt: params.user,
    systemPrompt: params.system,
    cliTrustedModeEnabled,
    workspaceScope: params.workspaceScope,
    images: params.images,
  });
}

export function describeError(err: unknown): string {
  if (err instanceof CliNotFoundError) {
    return "The `codex` CLI isn't on PATH — install it, or switch to a different backend.";
  }
  if (err instanceof CliTimeoutError) {
    return "Codex took too long to respond — try again, or switch to a different backend.";
  }
  if (!(err instanceof Error)) return "Generation via Codex failed.";
  if (/not logged in|log ?in|authentic/i.test(err.message)) {
    return "Codex isn't logged in — run `codex login` in a terminal, or switch to a different backend.";
  }
  return err.message;
}
