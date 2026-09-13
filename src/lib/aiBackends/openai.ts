import { getProviderKey } from "../models";
import { createOpenAiCompatibleBackend } from "./openaiCompatible";
import type { GenerateStructuredParams, GenerateTextParams } from "./types";

// Verify this against platform.openai.com/docs/models before relying on it —
// exact model IDs drift and this wasn't confirmed against a first-party
// reference at write time. Override with OPENAI_MODEL if it's stale.
const MODEL = process.env.OPENAI_MODEL ?? "gpt-6-astra";

// Rebuilt on every call (not cached) since the key is user-editable at
// runtime via Settings, unlike an env var fixed for the process lifetime.
async function backend() {
  const apiKey = (await getProviderKey("openai")) ?? process.env.OPENAI_API_KEY ?? "";
  return createOpenAiCompatibleBackend({
    apiKey,
    model: MODEL,
    providerLabel: "OpenAI",
    keyHelpText: "Get one at platform.openai.com/api-keys.",
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
