// Shared, client-safe types for problem-solving practice (lib/problems/).

export type ProblemSetKind = "coach" | "mixed";

// worked: every step shown, to study. faded: some steps blank, for the
// learner to fill in. independent: solved alone, with step hints on request.
export type ProblemStage = "worked" | "faded" | "independent";

export interface ProblemStep {
  // The step's working, as it would appear in a model solution.
  text: string;
  // A nudge toward this step without giving it away.
  hint: string;
}

export interface Problem {
  stage: ProblemStage;
  concept: string;
  statement: string;
  steps: ProblemStep[];
  // For a faded problem: the steps the learner fills in.
  blanks: number[];
  answer: string;
}

export interface ProblemSetContent {
  problems: Problem[];
}

export type Verdict = "correct" | "partial" | "incorrect";

export interface ProblemProgress {
  // Faded problems: the learner's text per blank step, and its verdict.
  stepAnswers: Record<number, { text: string; verdict: Verdict; feedback: string }>;
  // Independent problems: the learner's full solution and its verdict.
  solution: { text: string; verdict: Verdict; feedback: string } | null;
  hintsUsed: number;
  // Faded problems: blank steps the learner gave up on and looked at.
  revealed: number[];
  done: boolean;
}

export interface ProblemSet {
  id: number;
  course_id: number;
  chapter_id: number | null;
  kind: ProblemSetKind;
  title: string;
  problems: Problem[];
  progress: ProblemProgress[];
  practice_item_id: number | null;
  created_at: string;
}

export function emptyProgress(): ProblemProgress {
  return { stepAnswers: {}, solution: null, hintsUsed: 0, revealed: [], done: false };
}

// What the browser gets: a step's working stays hidden until the learner
// has earned it (filled it in, revealed it, or finished the problem), and
// only the hints they've asked for are included.
export interface PublicStep {
  text: string | null;
  hint: string | null;
}

export interface PublicProblem extends Omit<Problem, "steps" | "answer"> {
  steps: PublicStep[];
  answer: string | null;
}
