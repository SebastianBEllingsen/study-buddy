import Anthropic from "@anthropic-ai/sdk";
import { getProviderKey } from "../models";
import type {
  GenerateStructuredParams,
  GenerateTextParams,
  WebSearchCitation,
  WebSearchParams,
  WebSearchResult,
} from "./types";
import { stripCodeFences } from "./jsonText";

// Model + effort chosen for cost/quality fit: generating quiz/flashcard/notes
// content from supplied text is closer to structured extraction than deep
// reasoning, so we don't need Opus-tier pricing or max effort here.
const MODEL = "claude-sonnet-5";
// Efficiency mode's cheaper sibling — see params.efficient's doc comment in
// aiBackends/types.ts and app_settings.ai_efficiency_mode in models.ts.
const EFFICIENT_MODEL = "claude-haiku-4-5-20251001";

function modelFor(efficient?: boolean): string {
  return efficient ? EFFICIENT_MODEL : MODEL;
}

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

/**
 * Calls Claude expecting a single JSON object back, parses it, and retries
 * once with a corrective follow-up if the first response isn't valid JSON.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams
): Promise<T> {
  const { system, user, maxTokens = 8000, effort = "medium", efficient } = params;
  const model = modelFor(efficient);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const anthropic = await client();

  const response = await anthropic.messages.create({
    model,
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
      model,
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
  const { system, user, maxTokens = 8000, effort = "medium", efficient, images } = params;
  const model = modelFor(efficient);
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
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort },
  });

  return extractText(response);
}

// Server-side web search. The dynamic-filtering variant needs a current
// Sonnet/Opus model; efficiency mode's Haiku takes the basic one.
function webSearchTool(efficient: boolean | undefined, maxUses: number): Anthropic.ToolUnion {
  return efficient
    ? { type: "web_search_20250305", name: "web_search", max_uses: maxUses }
    : { type: "web_search_20260209", name: "web_search", max_uses: maxUses };
}

// A long search turn can come back with stop_reason "pause_turn" — resumed
// by re-sending the paused assistant turn as-is (no extra user message).
// Capped so a turn that keeps pausing can't loop forever.
const MAX_PAUSE_CONTINUATIONS = 4;

export function collectCitations(content: Anthropic.ContentBlock[]): WebSearchCitation[] {
  const seen = new Map<string, WebSearchCitation>();
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (!seen.has(result.url)) seen.set(result.url, { url: result.url, title: result.title });
      }
    } else if (block.type === "text" && block.citations) {
      for (const citation of block.citations) {
        if (citation.type === "web_search_result_location" && !seen.has(citation.url)) {
          seen.set(citation.url, { url: citation.url, title: citation.title ?? undefined });
        }
      }
    }
  }
  return [...seen.values()];
}

export async function generateTextWithWebSearch(params: WebSearchParams): Promise<WebSearchResult> {
  const { system, user, maxTokens = 8000, efficient, maxSearches = 5 } = params;
  const model = modelFor(efficient);
  const anthropic = await client();
  const tools = [webSearchTool(efficient, maxSearches)];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const content: Anthropic.ContentBlock[] = [];
  let response = await anthropic.messages.create({ model, max_tokens: maxTokens, system, messages, tools });
  content.push(...response.content);
  for (let i = 0; response.stop_reason === "pause_turn" && i < MAX_PAUSE_CONTINUATIONS; i++) {
    messages.push({ role: "assistant", content: response.content });
    response = await anthropic.messages.create({ model, max_tokens: maxTokens, system, messages, tools });
    content.push(...response.content);
  }

  // Only the final response's text is the answer — earlier (paused) turns'
  // text is interim narration between searches.
  return { text: extractText(response), citations: collectCitations(content), searched: true };
}
