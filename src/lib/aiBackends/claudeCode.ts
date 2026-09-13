import os from "node:os";
import { runCli, CliNotFoundError, CliTimeoutError } from "./cliRunner";
import type { GenerateStructuredParams, GenerateTextParams } from "./types";

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

// Fixed instruction passed as the `-p` argument — never interpolates any
// variable/untrusted content (see cliRunner.ts). The actual system prompt
// and user prompt (which embeds untrusted PDF text) go via stdin instead;
// Claude Code's non-interactive mode reads stdin and appends it to the
// prompt when stdin isn't a TTY.
const STDIN_INSTRUCTION =
  "Follow the SYSTEM INSTRUCTIONS and respond to the USER REQUEST below, both provided via stdin.";

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
}): Promise<ClaudeResult> {
  const args = [
    "-p",
    STDIN_INSTRUCTION,
    "--output-format",
    "json",
    "--model",
    "sonnet",
    "--effort",
    params.effort,
    ...HARDENING_ARGS,
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
      cwd: os.tmpdir(),
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
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  const effort = params.effort === "low" || params.effort === "high" ? params.effort : "medium";

  const first = await runClaude({
    userPrompt: params.user,
    systemPrompt: params.system,
    effort,
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
      userPrompt: `${params.user}\n\nYour previous response was not valid JSON:\n${first.result}\n\nRespond again with ONLY the corrected, valid JSON — no prose, no markdown code fences.`,
    });
    if (retry.is_error) {
      throw new Error(retry.result || `claude -p failed (${retry.subtype})`);
    }
    return JSON.parse(stripCodeFences(retry.result)) as T;
  }
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  if (params.images?.length) {
    throw new Error(
      "Image input isn't supported with the Claude Code backend — switch to the Anthropic API, OpenAI, Gemini, or Free backend in Settings."
    );
  }
  const effort = params.effort === "low" || params.effort === "high" ? params.effort : "medium";
  const result = await runClaude({
    userPrompt: params.user,
    systemPrompt: params.system,
    effort,
  });
  if (result.is_error) {
    throw new Error(result.result || `claude -p failed (${result.subtype})`);
  }
  return result.result;
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
