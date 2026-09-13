import { getProviderKey } from "../models";
import { createOpenAiCompatibleBackend } from "./openaiCompatible";
import type { GenerateStructuredParams, GenerateTextParams } from "./types";

// OpenRouter's free-model router: zero-cost, no credit card required, picks
// across their pool of free models per-request. Quality/reliability is
// inherently less predictable than a paid provider — fine for lightweight
// hint/explain asks, more variable for full quiz/notes/flashcard generation
// (structured JSON adherence isn't guaranteed across whichever free model
// gets picked).
const MODEL = "openrouter/free";
const BASE_URL = "https://openrouter.ai/api/v1";

async function backend() {
  const apiKey = (await getProviderKey("openrouter")) ?? process.env.OPENROUTER_API_KEY ?? "";
  return createOpenAiCompatibleBackend({
    apiKey,
    baseURL: BASE_URL,
    model: MODEL,
    providerLabel: "OpenRouter (free tier)",
    keyHelpText: "Get a free key (no card required) at openrouter.ai/keys.",
  });
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  return (await backend()).generateStructured<T>(params);
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  return (await backend()).generateText(params);
}

export async function describeError(err: unknown): Promise<string> {
  return (await backend()).describeError(err);
}
