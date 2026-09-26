// Shared, client-safe types for blurt and Feynman sessions (lib/explain/).

export type ExplainKind = "blurt" | "feynman";
export type ExplainStatus = "open" | "done";

export interface ExplainMessage {
  role: "student" | "novice";
  text: string;
}

// One idea from the topic, and how well the explanation covered it.
export interface CoverageItem {
  concept: string;
  status: "covered" | "partial" | "missing";
  note: string;
}

export interface GapCard {
  front: string;
  back: string;
  concept: string;
}

export interface ExplainResult {
  summary: string;
  coverage: CoverageItem[];
  // Things said that were wrong.
  errors: string[];
  cards: GapCard[];
}

export interface ExplainSession {
  id: number;
  course_id: number;
  chapter_id: number | null;
  kind: ExplainKind;
  topic: string;
  status: ExplainStatus;
  messages: ExplainMessage[];
  result: ExplainResult | null;
  practice_item_id: number | null;
  created_at: string;
}

// The novice asks at most this many questions before the evaluation.
export const MAX_NOVICE_QUESTIONS = 5;
