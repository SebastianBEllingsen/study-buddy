import { getAiBackend } from "./models";
import type { AiBackend } from "./models";
import * as anthropicApi from "./aiBackends/anthropicApi";
import * as claudeCode from "./aiBackends/claudeCode";
import * as codexCli from "./aiBackends/codexCli";
import * as openai from "./aiBackends/openai";
import * as gemini from "./aiBackends/gemini";
import * as free from "./aiBackends/free";
import type { GenerateStructuredParams, GenerateTextParams } from "./aiBackends/types";

// Dispatches to whichever AI backend is currently selected (app_settings.ai_provider,
// set from the UI — see components/SettingsDialog.tsx). All backends
// implement the same generateStructured/generateText/describeError shape, so
// callers (lib/generate.ts, lib/grading.ts) never need to know which is active.
async function backend() {
  switch (await getAiBackend()) {
    case "claude_code":
      return claudeCode;
    case "codex_cli":
      return codexCli;
    case "openai":
      return openai;
    case "gemini":
      return gemini;
    case "free":
      return free;
    case "api":
    default:
      return anthropicApi;
  }
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  return (await backend()).generateStructured<T>(params);
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  return (await backend()).generateText(params);
}

export async function describeAiError(err: unknown): Promise<string> {
  return await (await backend()).describeError(err);
}

export interface ModelInfo {
  provider: AiBackend;
  // A specific model id/name where one is actually known; "unknown" for
  // backends where it genuinely isn't (see the per-case comments below) —
  // callers should show that honestly rather than guessing.
  model: string;
}

// Mirrors backend()'s dispatch above, but reports what model each backend
// actually uses instead of loading it — kept in sync manually with the
// MODEL constant private to each aiBackends/* module, since generateStructured
// / generateText only return the generated content, not any metadata about
// what produced it. Used to tag each generated_items row so the UI can show
// which model made it (see createGeneratedItem/updateGeneratedItemContent).
export async function getModelInfo(efficient?: boolean): Promise<ModelInfo> {
  const provider = await getAiBackend();
  switch (provider) {
    case "claude_code":
      // --model flag in aiBackends/claudeCode.ts.
      return { provider, model: efficient ? "haiku" : "sonnet" };
    case "codex_cli":
      // No --model flag is passed (see aiBackends/codexCli.ts) — whatever
      // the installed Codex CLI defaults to, which this app can't see.
      return { provider, model: "unknown" };
    case "openai":
      return { provider, model: process.env.OPENAI_MODEL ?? "gpt-6-astra" };
    case "gemini":
      return { provider, model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" };
    case "free":
      // OpenRouter's free tier picks across a pool of models per-request;
      // the specific one actually served isn't captured by this backend.
      return { provider, model: "unknown" };
    case "api":
    default:
      // EFFICIENT_MODEL in aiBackends/anthropicApi.ts.
      return { provider, model: efficient ? "claude-haiku-4-5-20251001" : "claude-sonnet-5" };
  }
}
