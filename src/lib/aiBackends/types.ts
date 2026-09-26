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

// A text call that may search the web first — used to find learning
// resources for a study plan (lib/studyPlan/). Only backends with a real
// search tool implement generateTextWithWebSearch; aiClient.ts falls back to
// plain generateText (model knowledge only) for the rest. The prompt must
// never embed untrusted document text: a search-enabled call is the one
// place a prompt-injection payload could reach the network.
export interface WebSearchParams {
  system: string;
  user: string;
  maxTokens?: number;
  efficient?: boolean;
  // Upper bound on searches this one call may run.
  maxSearches?: number;
}

export interface WebSearchCitation {
  url: string;
  title?: string;
}

export interface WebSearchResult {
  text: string;
  // URLs the provider reports having actually seen in search results —
  // informational; every suggested link is still verified independently.
  citations: WebSearchCitation[];
  // False when the backend has no search tool and answered from model
  // knowledge alone.
  searched: boolean;
}

export interface AiBackendImpl {
  generateStructured<T>(params: GenerateStructuredParams): Promise<T>;
  generateText(params: GenerateTextParams): Promise<string>;
  generateTextWithWebSearch?(params: WebSearchParams): Promise<WebSearchResult>;
  describeError(err: unknown): string;
}
