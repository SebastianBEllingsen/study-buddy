import Anthropic from "@anthropic-ai/sdk";
import { getProviderKey } from "../models";
import type { GenerateStructuredParams, GenerateTextParams } from "./types";

// Model + effort chosen for cost/quality fit: generating quiz/flashcard/notes
// content from supplied text is closer to structured extraction than deep
// reasoning, so we don't need Opus-tier pricing or max effort here.
const MODEL = "claude-sonnet-5";

// Rebuilt on every call (not cached) since the key is user-editable at
// runtime via Settings, unlike an env var fixed for the process lifetime.
async function client(): Promise<Anthropic> {
  const apiKey = (await getProviderKey("anthropic")) ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is not set — add it in Settings, or create one at https://console.anthropic.com and add it to .env.local."
    );
  }
  return new Anthropic({ apiKey });
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Turns an Anthropic SDK error into a short, user-facing message instead of
 * the raw "{status} {json body}" string on Error#message — most importantly
 * for the common cases (no credits, rate limited, bad key) a user actually
 * needs to act on.
 */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key — check it in Settings (or ANTHROPIC_API_KEY in .env.local).";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your credit balance is too low to use the Anthropic API — add credits at console.anthropic.com/settings/billing.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API — wait a moment and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    // Covers the "credit balance too low" 400 alongside other bad-request cases.
    const msg = err.error && typeof err.error === "object" && "error" in err.error
      ? (err.error as { error?: { message?: string } }).error?.message
      : undefined;
    return msg ?? "The request to Anthropic was rejected — check the server log for details.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status}) — check the server log for details.`;
  }
  return err instanceof Error ? err.message : "Generation failed.";
}

// Claude sometimes wraps JSON in markdown code fences despite instructions
// not to; strip them defensively before parsing rather than failing/retrying
// on a purely cosmetic mismatch.
function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

/**
 * Calls Claude expecting a single JSON object back, parses it, and retries
 * once with a corrective follow-up if the first response isn't valid JSON.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  const { system, user, maxTokens = 8000, effort = "medium" } = params;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const anthropic = await client();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort },
  });

  const raw = extractText(response);
  try {
    return JSON.parse(stripCodeFences(raw)) as T;
  } catch {
    // Retry once: show Claude its own broken output and ask for a fix.
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        "That was not valid JSON. Respond again with ONLY the corrected, valid JSON object — no prose, no markdown code fences.",
    });

    const retry = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort },
    });

    const retryRaw = extractText(retry);
    return JSON.parse(stripCodeFences(retryRaw)) as T;
  }
}

type AnthropicImageMediaType = Anthropic.Base64ImageSource["media_type"];
const ANTHROPIC_IMAGE_MEDIA_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

/** Calls Claude for a plain-text (e.g. markdown) response — no JSON parsing. */
export async function generateText(params: GenerateTextParams): Promise<string> {
  const { system, user, maxTokens = 8000, effort = "medium", images } = params;
  const anthropic = await client();

  const content: Anthropic.ContentBlockParam[] = [
    ...(images ?? []).map((image): Anthropic.ImageBlockParam => {
      if (!ANTHROPIC_IMAGE_MEDIA_TYPES.includes(image.mimeType)) {
        throw new Error(`Unsupported image type for Claude: ${image.mimeType}`);
      }
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType as AnthropicImageMediaType,
          data: image.base64,
        },
      };
    }),
    { type: "text", text: user },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort },
  });

  return extractText(response);
}
