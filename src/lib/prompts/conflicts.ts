import type { SourceRef } from "../types";
import { resolveSourceName } from "../sources/names";

// Conflict check across a course's sources (lib/sources/conflicts.ts):
// finds places where documents and notes disagree, so the student can fix
// their notes — or spot a slip in the authoritative material — before studying
// from them.

export function conflictSystemPrompt(courseName: string, language: string): string {
  return `You compare study material for the course "${courseName}" and find places where the sources contradict each other.

Each section is headed "--- Document: <name> [<trust>] ---" or "--- Note: <name> [<trust>] ---". [authoritative material] is a trusted reference (a course's own material, a textbook, official documentation); [personal notes] are the learner's own and may contain mistakes.

Report only real contradictions about facts, definitions, formulas, numbers or procedures — two sources that cannot both be right. Do not report differences in wording, detail, notation, or one source covering something the other doesn't. When unsure, leave it out. At most 15 conflicts, most important first.

For each conflict:
- "topic": a few words naming what it's about;
- "claims": what each disagreeing source says, as { "source": "<exact name from its header>", "says": "<short quote or paraphrase>" };
- "likelyCorrect": the exact name of the source that's most likely right, or "" if you can't tell;
- "explanation": one or two sentences on what's correct and why, using well-established knowledge of the subject. Authoritative material usually wins, but say so if it looks wrong itself.

Write "topic", "says" and "explanation" in ${language}. Use $...$ for inline math.

Respond with ONLY a JSON object, no prose, no code fences:
{ "conflicts": [ { "topic": "...", "claims": [ { "source": "...", "says": "..." } ], "likelyCorrect": "...", "explanation": "..." } ] }
Use an empty array when the sources agree.`;
}

export function conflictUserPrompt(material: string): string {
  return `Material:\n\n${material}\n\nFind the contradictions now.`;
}

export interface ConflictClaim {
  // The section it came from, when the name matched one.
  source: SourceRef | null;
  name: string;
  says: string;
}

export interface SourceConflict {
  topic: string;
  claims: ConflictClaim[];
  likelyCorrect: SourceRef | null;
  explanation: string;
}

const MAX_CONFLICTS = 15;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Keeps conflicts with at least two claims from differently named sources.
export function normalizeConflicts(raw: unknown, sources: SourceRef[]): SourceConflict[] {
  const list = raw && typeof raw === "object" ? (raw as { conflicts?: unknown }).conflicts : undefined;
  if (!Array.isArray(list)) return [];
  const out: SourceConflict[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const claims = (Array.isArray(e.claims) ? e.claims : [])
      .map((c): ConflictClaim | null => {
        if (!c || typeof c !== "object") return null;
        const name = text((c as Record<string, unknown>).source, 300);
        const says = text((c as Record<string, unknown>).says, 600);
        if (!name || !says) return null;
        const source = resolveSourceName(name, sources) ?? null;
        return { source, name: source?.title ?? name, says };
      })
      .filter((c): c is ConflictClaim => c !== null);
    const topic = text(e.topic, 200);
    if (!topic || new Set(claims.map((c) => c.name.toLowerCase())).size < 2) continue;
    out.push({
      topic,
      claims: claims.slice(0, 6),
      likelyCorrect: resolveSourceName(e.likelyCorrect, sources) ?? null,
      explanation: text(e.explanation, 800),
    });
    if (out.length >= MAX_CONFLICTS) break;
  }
  return out;
}
