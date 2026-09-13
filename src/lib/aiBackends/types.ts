export interface GenerateStructuredParams {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
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
