export interface McqQuestion {
  type: "mcq";
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ShortAnswerQuestion {
  type: "short_answer";
  question: string;
  modelAnswer: string;
  explanation: string;
}

// "Select all that apply" — distinct from McqQuestion (exactly one correct
// answer, radio-button style): this can have 2+ correct answers and is
// answered with checkboxes. See QuizGenerationSettings for how a quiz opts
// into including these.
export interface MultiSelectQuestion {
  type: "multi_select";
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
}

export type QuizQuestion = McqQuestion | ShortAnswerQuestion | MultiSelectQuestion;

// What kinds of questions a quiz generation should include — see
// lib/prompts/quiz.ts (builds the prompt from this) and
// components/QuizGenerationDialog.tsx (the settings modal that produces
// it). At least one must be true.
export interface QuizGenerationSettings {
  singleChoice: boolean;
  multipleChoice: boolean;
  shortAnswer: boolean;
}

export const DEFAULT_QUIZ_SETTINGS: QuizGenerationSettings = {
  singleChoice: true,
  multipleChoice: false,
  shortAnswer: true,
};

export interface QuizContent {
  questions: QuizQuestion[];
}

export type CardMediaType = "video" | "image" | "audio";

// A video/image/audio clip shown on a card face above its text — only ever
// set on imported decks (see lib/anki/apkgReader.ts); AI-generated cards
// are text-only. `src` is an http(s) URL (media an imported deck links to
// rather than bundles), one of this app's own /api/blobs/ URLs, or a data: URL —
// see isSafeCardMediaSrc.
export interface CardMedia {
  type: CardMediaType;
  src: string;
}

export interface Flashcard {
  front: string;
  back: string;
  frontMedia?: CardMedia[];
  backMedia?: CardMedia[];
}

export interface FlashcardsContent {
  cards: Flashcard[];
  // Due-date reminders for the whole deck. Absent means on (the default) —
  // only ever stored as `false`, for decks the student doesn't want
  // scheduled: none of their cards count as due anywhere (see
  // deckDueCardIndices), though they can still be studied via "review all".
  reminders?: boolean;
}

export interface NotesContent {
  markdown: string;
}

export interface GradedAnswer {
  verdict: "correct" | "partial" | "incorrect";
  feedback: string;
}

export interface GradingResult {
  results: GradedAnswer[];
}
