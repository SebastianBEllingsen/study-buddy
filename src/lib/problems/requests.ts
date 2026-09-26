import type { ProblemAction } from "./service";
import type { ProblemSet } from "./types";
import { publicProblem } from "./view";

// What the browser gets for a problem set (see publicProblem).
export function publicSet(set: ProblemSet) {
  const { problems, ...rest } = set;
  return { ...rest, problems: problems.map((p, i) => publicProblem(p, set.progress[i])) };
}

export function parseProblemAction(body: Record<string, unknown>): ProblemAction | null {
  const problem = body.problem;
  if (!Number.isInteger(problem) || (problem as number) < 0) return null;
  const p = problem as number;
  const step = body.step === undefined ? undefined : Number.isInteger(body.step) ? (body.step as number) : null;
  if (step === null) return null;
  switch (body.action) {
    case "check":
      return typeof body.text === "string" && body.text.length <= 20_000 ? { action: "check", problem: p, step, text: body.text } : null;
    case "hint":
      return { action: "hint", problem: p };
    case "reveal":
      return { action: "reveal", problem: p, step };
    case "done":
      return { action: "done", problem: p };
    default:
      return null;
  }
}
