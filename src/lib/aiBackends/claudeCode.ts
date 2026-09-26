import os from "node:os";
import { runCli, CliNotFoundError, CliTimeoutError } from "./cliRunner";
import type {
  GenerateStructuredParams,
  GenerateTextImage,
  GenerateTextParams,
  GenerateWorkspaceScope,
  WebSearchParams,
  WebSearchResult,
} from "./types";
import { getAppSettings } from "../models";
import { materializeCliWorkspace } from "./cliWorkspace";
import { stripCodeFences } from "./jsonText";

// claude -p one-shot output shape (confirmed empirically against the
// installed CLI — this is not officially typed by the CLI itself).
interface ClaudeResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  total_cost_usd: number;
}

// Hardening for running a subprocess whose prompt embeds untrusted content
// (uploaded PDF text — course material from other students, per the user's
// own notes, so plausibly not fully trusted). Unlike the plain API backend
// (pure text in, text out, no tool access at all), Claude Code's harness has
// file/bash/web tools by default, so a prompt-injection payload hidden in a
// PDF could otherwise try to get it to read/write files or hit the network.
// --restricted strips code-execution tools and confines file tools; the
// explicit --disallowedTools list denies the rest of the meaningful built-ins
// outright (belt and suspenders); --strict-mcp-config skips any configured
// MCP servers as additional tool surface. cwd is a scratch temp dir rather
// than the project root, so even a tool that somehow ran would see nothing
// sensitive. All of this is a fixed, hardcoded arg list — see cliRunner.ts
// for why that matters on Windows.
const HARDENING_ARGS = [
  "--restricted",
  "--strict-mcp-config",
  "--disallowedTools",
  "Bash",
  "Read",
  "Write",
  "Edit",
  "WebFetch",
  "WebSearch",
  "Glob",
  "Grep",
  "NotebookEdit",
  "Task",
  "SlashCommand",
];

// Used for generateTextWithWebSearch only (finding study-plan resources):
// HARDENING_ARGS with exactly one built-in tool switched back on. --tools
// limits the available built-ins to WebSearch alone and --allowedTools lets
// it run without a permission prompt; WebFetch (arbitrary URL fetches) and
// every file/shell tool stay off, and --restricted/--strict-mcp-config stay
// on. Independent of cliTrustedModeEnabled on purpose — the prompts sent
// this way never embed document text (see WebSearchParams), so there's no
// reason to open more than search.
export const WEB_SEARCH_ARGS = [
  "--restricted",
  "--strict-mcp-config",
  "--tools",
  "WebSearch",
  "--allowedTools",
  "WebSearch",
  "--disallowedTools",
  "Bash",
  "Read",
  "Write",
  "Edit",
  "WebFetch",
  "Glob",
  "Grep",
  "NotebookEdit",
  "Task",
  "SlashCommand",
];

// Used instead of HARDENING_ARGS when AppSettings.cliTrustedModeEnabled is
// on — drops --restricted/--disallowedTools entirely, so Bash/Read/Write/
// Edit/WebFetch/WebSearch/etc. all become available. --strict-mcp-config is
// kept regardless: it only gates *additional* MCP-server tool surface,
// unrelated to what this toggle is meant to unlock, so there's no reason to
// also open arbitrary configured MCP servers. See cliWorkspace.ts for how
// cwd is confined even in this mode.
const TRUSTED_ARGS = ["--strict-mcp-config"];

// Fixed instruction passed as the `-p` argument — never interpolates any
// variable/untrusted content (see cliRunner.ts). The actual system prompt
// and user prompt (which embeds untrusted PDF text) go via stdin instead;
// Claude Code's non-interactive mode reads stdin and appends it to the
// prompt when stdin isn't a TTY.
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

// PDF text extraction occasionally yields stray NUL bytes (malformed content
// streams, odd encodings) — harmless to drop, since NULs carry no meaning in
// the resulting prompt text.
function sanitize(text: string): string {
  return text.replace(/\0/g, "");
}

function buildStdin(systemPrompt: string, userPrompt: string): string {
  return `SYSTEM INSTRUCTIONS:\n${sanitize(systemPrompt)}\n\n---\n\nUSER REQUEST:\n${sanitize(userPrompt)}`;
}

async function runClaude(params: {
  userPrompt: string;
  systemPrompt: string;
  effort: "low" | "medium" | "high";
  // See GenerateStructuredParams.efficient's doc comment in
  // aiBackends/types.ts — "haiku" is the CLI's own alias, same as "sonnet".
  efficient?: boolean;
  cliTrustedModeEnabled: boolean;
  workspaceScope?: GenerateWorkspaceScope;
  images?: GenerateTextImage[];
  // Overrides the TRUSTED_ARGS/HARDENING_ARGS choice — see WEB_SEARCH_ARGS.
  toolArgs?: string[];
}): Promise<ClaudeResult> {
  // Only pay for materializing a workspace when trusted mode is on AND
  // there's actually something to put in it — otherwise cwd stays
  // os.tmpdir(), exactly like the untrusted path, rather than creating an
  // empty directory for nothing.
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
      "-p",
      workspace ? STDIN_INSTRUCTION_WITH_WORKSPACE : STDIN_INSTRUCTION,
      "--output-format",
      "json",
      "--model",
      params.efficient ? "haiku" : "sonnet",
      "--effort",
      params.effort,
      ...(params.toolArgs ?? (params.cliTrustedModeEnabled ? TRUSTED_ARGS : HARDENING_ARGS)),
    ];

    // Strip API-key auth from the child's environment: the shell inherits
    // process.env by default, and if ANTHROPIC_API_KEY is set (e.g. for the
    // API backend) it outranks OAuth/subscription login per the CLI's own
    // credential resolution order — silently defeating the entire point of
    // this backend (avoiding per-token API billing).
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    let stdout: string;
    try {
      ({ stdout } = await runCli({
        command: "claude",
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
          "The `claude` CLI isn't on PATH — install Claude Code or switch back to the API key backend."
        );
      }
      throw err;
    }

    return JSON.parse(stdout) as ClaudeResult;
  } finally {
    await workspace?.cleanup();
  }
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  const { cliTrustedModeEnabled } = await getAppSettings();
  const effort = params.effort === "low" || params.effort === "high" ? params.effort : "medium";

  const first = await runClaude({
    userPrompt: params.user,
    systemPrompt: params.system,
    effort,
    efficient: params.efficient,
    cliTrustedModeEnabled,
    workspaceScope: params.workspaceScope,
  });
  if (first.is_error) {
    throw new Error(first.result || `claude -p failed (${first.subtype})`);
  }

  try {
    return JSON.parse(stripCodeFences(first.result)) as T;
  } catch {
    // Retry once: a fresh one-shot call (claude -p has no cheap way to
    // continue the same turn) asking it to fix its own broken output.
    const retry = await runClaude({
      systemPrompt: params.system,
      effort,
      efficient: params.efficient,
      cliTrustedModeEnabled,
      workspaceScope: params.workspaceScope,
      userPrompt: `${params.user}\n\nYour previous response was not valid JSON:\n${first.result}\n\nRespond again with ONLY the corrected, valid JSON — no prose, no markdown code fences.`,
    });
    if (retry.is_error) {
      throw new Error(retry.result || `claude -p failed (${retry.subtype})`);
    }
    return JSON.parse(stripCodeFences(retry.result)) as T;
  }
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  const { cliTrustedModeEnabled } = await getAppSettings();
  if (params.images?.length && !cliTrustedModeEnabled) {
    throw new Error(
      "Image input isn't supported with the Claude Code backend — switch to the Anthropic API, OpenAI, Gemini, or Free backend in Settings, or turn on full tool access for this CLI backend in Settings."
    );
  }
  const effort = params.effort === "low" || params.effort === "high" ? params.effort : "medium";
  const result = await runClaude({
    userPrompt: params.user,
    systemPrompt: params.system,
    effort,
    efficient: params.efficient,
    cliTrustedModeEnabled,
    workspaceScope: params.workspaceScope,
    images: params.images,
  });
  if (result.is_error) {
    throw new Error(result.result || `claude -p failed (${result.subtype})`);
  }
  return result.result;
}

export async function generateTextWithWebSearch(params: WebSearchParams): Promise<WebSearchResult> {
  const result = await runClaude({
    userPrompt: params.user,
    systemPrompt: params.system,
    effort: params.efficient ? "low" : "medium",
    efficient: params.efficient,
    // Never a materialized workspace — see WEB_SEARCH_ARGS.
    cliTrustedModeEnabled: false,
    toolArgs: WEB_SEARCH_ARGS,
  });
  if (result.is_error) {
    throw new Error(result.result || `claude -p failed (${result.subtype})`);
  }
  // `claude -p --output-format json` reports only the final text, not the
  // search results it saw.
  return { text: result.result, citations: [], searched: true };
}

export function describeError(err: unknown): string {
  if (err instanceof CliNotFoundError) {
    return "The `claude` CLI isn't on PATH — install Claude Code or switch back to the API key backend.";
  }
  if (err instanceof CliTimeoutError) {
    return "Claude Code took too long to respond — try again, or switch to the API key backend.";
  }
  if (!(err instanceof Error)) return "Generation via Claude Code failed.";
  if (err.message.includes("Not logged in")) {
    return "Claude Code isn't logged in — run `claude /login` in a terminal, or switch back to the API key backend.";
  }
  return err.message;
}
