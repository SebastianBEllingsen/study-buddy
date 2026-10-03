import type { ProblemAction } from "./service";
import { MATCHES } from "./mathCheck";
import type { FinalMatch, ProblemSet } from "./types";
import { publicProblem } from "./view";

// What the browser gets for a problem set (see publicProblem).
export function publicSet(set: ProblemSet) {
  const { problems, ...rest } = set;
  return { ...rest, problems: problems.map((p, i) => publicProblem(p, set.progress[i])) };
}

// The learner's final answer and what the browser's computer algebra made of
// it (see mathCheck.ts); anything malformed is simply left out.
function parseFinal(v: unknown): { text: string; match: FinalMatch } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { text, match } = v as { text?: unknown; match?: unknown };
  const known = MATCHES.find((m) => m === match);
  return typeof text === "string" && text.trim() && text.length <= 500 && known ? { text: text.trim(), match: known } : undefined;
}

export function parseProblemAction(body: Record<string, unknown>): ProblemAction | null {
  const problem = body.problem;
  if (!Number.isInteger(problem) || (problem as number) < 0) return null;
  const p = problem as number;
  const step = body.step === undefined ? undefined : Number.isInteger(body.step) ? (body.step as number) : null;
  if (step === null) return null;
  switch (body.action) {
    case "check":
      if (typeof body.text !== "string" || body.text.length > 20_000) return null;
      return { action: "check", problem: p, step, text: body.text, final: parseFinal(body.final) };
    case "expr":
      return typeof body.text === "string" && body.text.trim() && body.text.length <= 500
        ? { action: "expr", problem: p, text: body.text.trim() }
        : null;
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
