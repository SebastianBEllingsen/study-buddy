import type { Problem, ProblemProgress, PublicProblem } from "./types";

// See PublicProblem in types.ts. Client-safe and pure.
export function publicProblem(problem: Problem, progress: ProblemProgress): PublicProblem {
  const earned = (i: number) => {
    if (progress.done || problem.stage === "worked") return true;
    if (problem.stage === "faded") {
      if (!problem.blanks.includes(i)) return true;
      return progress.revealed.includes(i) || progress.stepAnswers[i]?.verdict === "correct";
    }
    return false;
  };
  return {
    ...problem,
    steps: problem.steps.map((s, i) => ({
      text: earned(i) ? s.text : null,
      // Independent problems hand out hints one at a time, in order.
      hint: problem.stage === "independent" ? (i < progress.hintsUsed || progress.done ? s.hint : null) : s.hint,
    })),
    // The answer would give away a faded problem's blanks, too.
    answer: problem.stage === "worked" || progress.done ? problem.answer : null,
  };
}
