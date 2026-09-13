import OpenAI from "openai";
import type { GenerateStructuredParams, GenerateTextImage, GenerateTextParams } from "./types";

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  /** Used in error/setup messages, e.g. "OpenAI" or "OpenRouter". */
  providerLabel: string;
  /** Where to point someone whose key is missing/invalid. */
  keyHelpText: string;
}

// Shared by both the OpenAI backend and the free-tier (OpenRouter) backend —
// OpenRouter exposes an OpenAI-compatible chat/completions endpoint, so one
// factory covers both, differing only in apiKey/baseURL/model.
//
// `effort` from GenerateStructuredParams/GenerateTextParams is intentionally
// not forwarded here: it's an Anthropic-specific extended-thinking knob, and
// blindly mapping it to an OpenAI reasoning-effort field risks 400s on
// models/providers (especially free-tier ones) that don't support it.
export function createOpenAiCompatibleBackend(config: OpenAiCompatibleConfig) {
  function client(): OpenAI {
    if (!config.apiKey) {
      throw new Error(
        `${config.providerLabel} API key is not set — add it in Settings. ${config.keyHelpText}`
      );
    }
    return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
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
    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      ...(images ?? []).map(
        (image): OpenAI.Chat.ChatCompletionContentPart => ({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
        })
      ),
      { type: "text", text: user },
    ];

    const response = await client().chat.completions.create({
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: images?.length ? userContent : user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    });
    return response.choices[0]?.message?.content ?? "";
  }

  return {
    async generateStructured<T>(params: GenerateStructuredParams): Promise<T> {
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
    },

    async generateText(params: GenerateTextParams): Promise<string> {
      const { system, user, maxTokens = 8000, images } = params;
      return complete(system, user, maxTokens, false, images);
    },

    describeError(err: unknown): string {
      if (err instanceof OpenAI.AuthenticationError) {
        return `${config.providerLabel} rejected the API key — check it in Settings.`;
      }
      if (err instanceof OpenAI.RateLimitError) {
        return `Rate limited by ${config.providerLabel} — wait a moment and try again.`;
      }
      if (err instanceof OpenAI.PermissionDeniedError) {
        return `${config.providerLabel} denied the request — check your account's access/billing.`;
      }
      if (err instanceof OpenAI.APIError) {
        return `${config.providerLabel} API error (${err.status}) — check the server log for details.`;
      }
      return err instanceof Error ? err.message : "Generation failed.";
    },
  };
}
