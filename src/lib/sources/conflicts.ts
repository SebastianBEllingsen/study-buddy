import { desc, eq, and, ne } from "drizzle-orm";
import { db, source_checks } from "../db";
import { generateStructured } from "../aiClient";
import { buildCourseContext, chunkCourseContext } from "../context";
import { languageName } from "../languages";
import { getAppSettings } from "../models";
import { conflictSystemPrompt, conflictUserPrompt, normalizeConflicts, type SourceConflict } from "../prompts/conflicts";
import { mapWithConcurrency } from "../concurrency";
import { nowUtc } from "../time";
import type { SourceRef } from "../types";

export interface ConflictCheck {
  conflicts: SourceConflict[];
  // The course's material was too large for one comparison, so it was
  // compared in parts: sources far apart in the course weren't compared.
  partial: boolean;
  sourceCount: number;
}

export interface StoredConflictCheck extends ConflictCheck {
  createdAt: string;
  sourceKeys: string[];
}

export class NotEnoughSourcesError extends Error {
  constructor() {
    super("There's nothing to compare yet — this needs at least two documents or notes marked for generation.");
    this.name = "NotEnoughSourcesError";
  }
}

export function sourceKey(source: Pick<SourceRef, "kind" | "id">): string {
  return `${source.kind === "note" ? "note" : "doc"}:${source.id}`;
}

// Sources added since the last check — what makes "check again" worth it.
export function newSourceCount(current: string[], checked: string[]): number {
  const seen = new Set(checked);
  return current.filter((k) => !seen.has(k)).length;
}

// Compares every extracted document and every note marked for generation
// in the course, and saves the findings (replacing the previous check).
export async function runConflictCheck(courseId: number): Promise<StoredConflictCheck> {
  const context = await buildCourseContext(courseId);
  if (context.sources.length < 2) throw new NotEnoughSourcesError();
  const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
  const parts = context.needsChunking ? chunkCourseContext(context) : [context.combinedText];
  const found = await mapWithConcurrency(parts, 2, async (part) =>
    normalizeConflicts(
      await generateStructured<unknown>({
        system: conflictSystemPrompt(context.courseName, languageName(preferredLanguage)),
        user: conflictUserPrompt(part),
        maxTokens: 4000,
        effort: efficient ? "low" : "medium",
        efficient,
      }),
      context.sources
    )
  );
  const check: ConflictCheck = {
    conflicts: found.flat(),
    partial: parts.length > 1,
    sourceCount: context.sources.length,
  };
  const sourceKeys = context.sources.map(sourceKey);
  const createdAt = nowUtc();
  const [row] = await db
    .insert(source_checks)
    .values({ course_id: courseId, source_keys_json: JSON.stringify(sourceKeys), result_json: JSON.stringify(check), created_at: createdAt })
    .returning({ id: source_checks.id });
  await db.delete(source_checks).where(and(eq(source_checks.course_id, courseId), ne(source_checks.id, row.id)));
  return { ...check, createdAt, sourceKeys };
}

export async function latestConflictCheck(courseId: number): Promise<StoredConflictCheck | null> {
  const [row] = await db
    .select()
    .from(source_checks)
    .where(eq(source_checks.course_id, courseId))
    .orderBy(desc(source_checks.id))
    .limit(1);
  if (!row) return null;
  try {
    const check = JSON.parse(row.result_json) as ConflictCheck;
    return { ...check, createdAt: row.created_at, sourceKeys: JSON.parse(row.source_keys_json) as string[] };
  } catch {
    return null;
  }
}
