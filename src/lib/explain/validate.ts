import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanConceptName } from "../conceptName";
import type { CoverageItem, ExplainResult, GapCard } from "./types";

export const MAX_GAP_CARDS = 10;
const STATUSES = ["covered", "partial", "missing"] as const;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function normalizeExplainResult(raw: unknown): ExplainResult {
  const r = obj(raw);
  const coverage: CoverageItem[] = (Array.isArray(r.coverage) ? r.coverage : []).flatMap((c) => {
    const o = obj(c);
    const concept = cleanConceptName(o.concept);
    const status = STATUSES.find((s) => s === o.status);
    return concept && status ? [{ concept, status, note: str(o.note, 500) }] : [];
  });
  if (coverage.length === 0) throw new InvalidAiResponseError("no coverage");
  const cards: GapCard[] = (Array.isArray(r.cards) ? r.cards : []).flatMap((c) => {
    const o = obj(c);
    const front = str(o.front, 2000);
    const back = str(o.back, 4000);
    return front && back ? [{ front, back, concept: cleanConceptName(o.concept) ?? coverage[0].concept }] : [];
  });
  return {
    summary: str(r.summary, 1000),
    coverage,
    errors: (Array.isArray(r.errors) ? r.errors : []).map((e) => str(e, 500)).filter(Boolean).slice(0, 10),
    cards: cards.slice(0, MAX_GAP_CARDS),
  };
}
