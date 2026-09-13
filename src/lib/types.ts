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

export type QuizQuestion = McqQuestion | ShortAnswerQuestion;

export interface QuizContent {
  questions: QuizQuestion[];
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface FlashcardsContent {
  cards: Flashcard[];
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
