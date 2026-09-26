import { eq } from "drizzle-orm";
import { concepts, db } from "../db";
import { cleanConceptName, conceptKey } from "../conceptName";
import { nowUtc } from "../time";

// A course's concepts: the named ideas its cards and questions are tagged
// with (`concept` on each card/question). Rows are created on demand the
// first time a tag is seen, matched case-insensitively.

export type ConceptRow = typeof concepts.$inferSelect;

export async function listConceptsForCourse(courseId: number): Promise<ConceptRow[]> {
  return db.select().from(concepts).where(eq(concepts.course_id, courseId));
}

// The concept id for each name (keyed by conceptKey), creating what's
// missing. `chapterIds` links new concepts to a study plan chapter.
export async function findOrCreateConcepts(
  courseId: number,
  names: string[],
  chapterIds: Map<string, number> = new Map()
): Promise<Map<string, number>> {
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = cleanConceptName(raw);
    if (name && !wanted.has(conceptKey(name))) wanted.set(conceptKey(name), name);
  }
  const ids = new Map<string, number>();
  if (wanted.size === 0) return ids;

  for (const row of await listConceptsForCourse(courseId)) {
    const key = conceptKey(row.name);
    if (wanted.has(key) && !ids.has(key)) ids.set(key, row.id);
  }
  for (const [key, name] of wanted) {
    if (ids.has(key)) continue;
    const [row] = await db
      .insert(concepts)
      .values({ course_id: courseId, chapter_id: chapterIds.get(key) ?? null, name, created_at: nowUtc() })
      .returning({ id: concepts.id });
    ids.set(key, row.id);
  }
  return ids;
}

export async function conceptIdFor(courseId: number, name: string | undefined): Promise<number | null> {
  const clean = cleanConceptName(name);
  if (!clean) return null;
  return (await findOrCreateConcepts(courseId, [clean])).get(conceptKey(clean)) ?? null;
}
