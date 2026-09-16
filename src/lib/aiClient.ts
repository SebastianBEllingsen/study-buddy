import { getAiBackend, getImageAiBackend, isAiEnabled } from "./models";
import type { AiBackend } from "./models";
import * as anthropicApi from "./aiBackends/anthropicApi";
import * as claudeCode from "./aiBackends/claudeCode";
import * as codexCli from "./aiBackends/codexCli";
import * as openai from "./aiBackends/openai";
import * as gemini from "./aiBackends/gemini";
import * as free from "./aiBackends/free";
import type { GenerateStructuredParams, GenerateTextParams } from "./aiBackends/types";

function backendModule(id: AiBackend) {
  switch (id) {
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

// Which backend id a call should actually use — app_settings.ai_provider,
// set from the UI (see components/SettingsDialog.tsx), except an
// image-bearing call defers to app_settings.image_ai_provider first when
// that override is set (see AppSettings.imageAiBackend's doc comment;
// claude_code/codex_cli can't take image input at all). All backends
// implement the same generateStructured/generateText/describeError shape, so
// callers (lib/generate.ts, lib/grading.ts) never need to know which is
// active.
async function resolveBackendId(hasImages: boolean): Promise<AiBackend> {
  if (hasImages) {
    const override = await getImageAiBackend();
    if (override) return override;
  }
  return getAiBackend();
}

// Thrown by both calls below when app_settings.ai_enabled is off — the one
// choke point every AI call in the app goes through (generate.ts, chat.ts,
// grading.ts, tidyText.ts, and the ask-AI routes all call one of these two
// functions directly), so gating here covers all of them without each
// caller needing its own check. The UI is expected to hide/disable every AI
// control when the setting is off (see SettingsDialog's "Enable AI
// features" toggle), so reaching this in practice means a stale client.
export class AiDisabledError extends Error {
  constructor() {
    super("AI features are turned off — enable them in Settings to use this.");
    this.name = "AiDisabledError";
  }
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  if (!(await isAiEnabled())) throw new AiDisabledError();
  const id = await resolveBackendId(false);
  return backendModule(id).generateStructured<T>(params);
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  if (!(await isAiEnabled())) throw new AiDisabledError();
  const id = await resolveBackendId(!!params.images?.length);
  return backendModule(id).generateText(params);
}

// hasImages must match whatever the failing generateText call itself passed
// (its images?.length), so a failure from an image-backend-override call
// gets described by that same backend, not whichever one is main — a
// mismatch here could ask the wrong backend's describeError to interpret an
// error shape (e.g. instanceof checks) it doesn't recognize.
export async function describeAiError(err: unknown, hasImages = false): Promise<string> {
  const id = await resolveBackendId(hasImages);
  return backendModule(id).describeError(err);
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
