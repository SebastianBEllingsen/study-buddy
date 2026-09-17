// A generation call's course-document scope, used only by claudeCode.ts/
// codexCli.ts (see aiBackends/cliWorkspace.ts) when AppSettings.cliTrustedModeEnabled
// is on, to materialize the relevant documents into the CLI's workspace
// directory alongside a manifest.json lookup table. Every other backend
// ignores this field entirely, same convention as `efficient` above.
export interface GenerateWorkspaceScope {
  documentIds: number[];
}

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
  workspaceScope?: GenerateWorkspaceScope;
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
  // Vision input — anthropicApi, openai/free (openaiCompatible), and gemini
  // pass this straight through to the provider's own vision input. claudeCode/
  // codexCli instead write each image into a materialized workspace directory
  // and point the CLI at it via Read (see aiBackends/cliWorkspace.ts), but
  // only when AppSettings.cliTrustedModeEnabled is on — otherwise they still
  // throw, same as always.
  images?: GenerateTextImage[];
  workspaceScope?: GenerateWorkspaceScope;
}

export interface AiBackendImpl {
  generateStructured<T>(params: GenerateStructuredParams): Promise<T>;
  generateText(params: GenerateTextParams): Promise<string>;
  describeError(err: unknown): string;
}
