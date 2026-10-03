// Shared, client-safe pieces of page transcription (lib/transcribe/).

// The most pages one document is transcribed in: a cost guard, not a limit of
// the method.
export const MAX_PAGES = 120;

// How many pages go to the AI in one call.
export const MAX_PAGES_PER_CALL = 3;

export interface PageImage {
  page: number;
  base64: string;
  mimeType: "image/jpeg" | "image/png";
}

export interface TranscribedPage {
  page: number;
  markdown: string;
}
