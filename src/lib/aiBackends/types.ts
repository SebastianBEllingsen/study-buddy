export interface GenerateStructuredParams {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  // "Efficiency mode" (app_settings.ai_efficiency_mode) — separate from
  // `effort`, which only tunes how hard the *same* model thinks. This tells
  // a backend that can pick between sibling models (anthropicApi,
  // claudeCode — see their own MODEL/--model selection) to use its cheaper,
  // faster one instead. Ignored by backends with only one model to offer
  // (openai/gemini/free/codexCli), same as `effort` already is by
  // openaiCompatible.
  efficient?: boolean;
}

export interface GenerateTextImage {
  base64: string;
  mimeType: string;
}

export interface GenerateTextParams {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  // See GenerateStructuredParams.efficient's doc comment above.
  efficient?: boolean;
  // Vision input — only anthropicApi, openai/free (openaiCompatible), and
  // gemini support this; claudeCode/codexCli throw if it's passed (see their
  // generateText for why: they're CLI shims with no confirmed image-input
  // path).
  images?: GenerateTextImage[];
}

export interface AiBackendImpl {
  generateStructured<T>(params: GenerateStructuredParams): Promise<T>;
  generateText(params: GenerateTextParams): Promise<string>;
  describeError(err: unknown): string;
}
