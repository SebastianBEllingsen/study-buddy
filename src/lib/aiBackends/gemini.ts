import { GoogleGenAI, ApiError } from "@google/genai";
import { getProviderKey } from "../models";
import type { GenerateStructuredParams, GenerateTextImage, GenerateTextParams } from "./types";
import { withRetry, isRetryableStatus } from "./retry";

// Verify this against ai.google.dev/gemini-api/docs/models before relying on
// it — exact model IDs drift and this wasn't confirmed against a first-party
// reference at write time. Override with GEMINI_MODEL if it's stale.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

async function client(): Promise<GoogleGenAI> {
  const apiKey = (await getProviderKey("gemini")) ?? process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "Gemini API key is not set — add it in Settings. Get a free one at aistudio.google.com/apikey."
    );
  }
  return new GoogleGenAI({ apiKey });
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

async function complete(
  system: string,
  user: string,
  maxTokens: number,
  jsonMode: boolean,
  images?: GenerateTextImage[]
): Promise<string> {
  const genAI = await client();
  const contents = images?.length
    ? [
        {
          role: "user" as const,
          parts: [
            ...images.map((image) => ({
              inlineData: { mimeType: image.mimeType, data: image.base64 },
            })),
            { text: user },
          ],
        },
      ]
    : user;
  const response = await withRetry(
    () =>
      genAI.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction: system,
          maxOutputTokens: maxTokens,
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
    (err) => err instanceof ApiError && isRetryableStatus(err.status)
  );
  return response.text ?? "";
}

export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  const { system, user, maxTokens = 8000 } = params;
  const raw = await complete(system, user, maxTokens, true);
  try {
    return JSON.parse(stripCodeFences(raw)) as T;
  } catch {
    const retryRaw = await complete(
      system,
      `${user}\n\nYour previous response was not valid JSON:\n${raw}\n\nRespond again with ONLY the corrected, valid JSON object — no prose, no markdown code fences.`,
      maxTokens,
      true
    );
    return JSON.parse(stripCodeFences(retryRaw)) as T;
  }
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  const { system, user, maxTokens = 8000, images } = params;
  return complete(system, user, maxTokens, false, images);
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    // Gemini returns 400 INVALID_ARGUMENT/API_KEY_INVALID for a bad key
    // rather than 401/403, so check the message too, not just status.
    if (err.status === 401 || err.status === 403 || /api_key_invalid/i.test(err.message)) {
      return "Gemini rejected the API key — check it in Settings.";
    }
    if (err.status === 429) {
      return "Rate limited by the Gemini API — wait a moment and try again.";
    }
    return `Gemini API error (${err.status}) — check the server log for details.`;
  }
  return err instanceof Error ? err.message : "Generation failed.";
}
