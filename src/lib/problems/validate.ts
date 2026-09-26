import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanConceptName } from "../conceptName";
import type { Problem, ProblemStage, ProblemStep, Verdict } from "./types";

const STAGES: ProblemStage[] = ["worked", "faded", "independent"];

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function normalizeProblems(raw: unknown, kind: "coach" | "mixed"): { title: string; problems: Problem[] } {
  const r = obj(raw);
  const problems = (Array.isArray(r.problems) ? r.problems : []).slice(0, 8).flatMap((p): Problem[] => {
    const o = obj(p);
    const statement = str(o.statement, 8000);
    const steps: ProblemStep[] = (Array.isArray(o.steps) ? o.steps : [])
      .slice(0, 10)
      .map((s) => ({ text: str(obj(s).text, 4000), hint: str(obj(s).hint, 600) }))
      .filter((s) => s.text);
    if (!statement || steps.length === 0) return [];
    let stage = kind === "mixed" ? "independent" : (STAGES.find((s) => s === o.stage) ?? "independent");
    let blanks =
      stage === "faded"
        ? [...new Set((Array.isArray(o.blanks) ? o.blanks : []).filter((b): b is number => Number.isInteger(b) && b > 0 && b < steps.length))]
        : [];
    // A faded problem with nothing (valid) to fill in blanks its last step.
    if (stage === "faded" && blanks.length === 0) {
      if (steps.length > 1) blanks = [steps.length - 1];
      else stage = "independent";
    }
    return [
      {
        stage,
        concept: cleanConceptName(o.concept) ?? "Problem solving",
        statement,
        steps,
        blanks: blanks.sort((a, b) => a - b),
        answer: str(o.answer, 2000) || steps[steps.length - 1].text,
      },
    ];
  });
  if (problems.length === 0) throw new InvalidAiResponseError("no problems");
  // Coached sets always run worked → faded → independent.
  if (kind === "coach") problems.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  return { title: str(r.title, 200), problems: kind === "mixed" ? interleaveByConcept(problems) : problems };
}

// Reorders so no two neighbours share a concept where that's possible.
export function interleaveByConcept<T extends { concept: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.concept.toLowerCase(), [...(groups.get(item.concept.toLowerCase()) ?? []), item]);
  const out: T[] = [];
  let last: string | null = null;
  while (out.length < items.length) {
    const candidates = [...groups.entries()].filter(([, g]) => g.length > 0).sort((a, b) => b[1].length - a[1].length);
    const pick = candidates.find(([k]) => k !== last) ?? candidates[0];
    out.push(pick[1].shift() as T);
    last = pick[0];
  }
  return out;
}

export function normalizeCheck(raw: unknown): { verdict: Verdict; feedback: string } {
  const r = obj(raw);
  const verdict = (["correct", "partial", "incorrect"] as const).find((v) => v === r.verdict);
  if (!verdict) throw new InvalidAiResponseError("no verdict");
  return { verdict, feedback: str(r.feedback, 1500) };
}
