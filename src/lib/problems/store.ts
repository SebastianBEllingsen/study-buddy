import { desc, eq } from "drizzle-orm";
import { db, problem_sets } from "../db";
import { nowUtc } from "../time";
import { emptyProgress, type Problem, type ProblemProgress, type ProblemSet, type ProblemSetKind } from "./types";

type Row = typeof problem_sets.$inferSelect;

function toSet(row: Row): ProblemSet {
  const problems = (JSON.parse(row.content_json) as { problems: Problem[] }).problems;
  const saved = JSON.parse(row.progress_json) as ProblemProgress[];
  return {
    id: row.id,
    course_id: row.course_id,
    chapter_id: row.chapter_id,
    kind: row.kind,
    title: row.title,
    problems,
    progress: problems.map((_, i) => ({ ...emptyProgress(), ...saved[i] })),
    practice_item_id: row.practice_item_id,
    created_at: row.created_at,
  };
}

export async function createProblemSet(input: {
  courseId: number;
  chapterId: number | null;
  kind: ProblemSetKind;
  title: string;
  problems: Problem[];
}): Promise<ProblemSet> {
  const now = nowUtc();
  const [row] = await db
    .insert(problem_sets)
    .values({
      course_id: input.courseId,
      chapter_id: input.chapterId,
      kind: input.kind,
      title: input.title,
      content_json: JSON.stringify({ problems: input.problems }),
      progress_json: JSON.stringify(input.problems.map(() => emptyProgress())),
      created_at: now,
      updated_at: now,
    })
    .returning();
  return toSet(row);
}

export async function getProblemSet(id: number): Promise<ProblemSet | null> {
  const [row] = await db.select().from(problem_sets).where(eq(problem_sets.id, id)).limit(1);
  return row ? toSet(row) : null;
}

export async function listProblemSets(courseId: number): Promise<ProblemSet[]> {
  const rows = await db
    .select()
    .from(problem_sets)
    .where(eq(problem_sets.course_id, courseId))
    .orderBy(desc(problem_sets.created_at), desc(problem_sets.id));
  return rows.map(toSet);
}

export async function saveProgress(id: number, progress: ProblemProgress[]): Promise<void> {
  await db
    .update(problem_sets)
    .set({ progress_json: JSON.stringify(progress), updated_at: nowUtc() })
    .where(eq(problem_sets.id, id));
}

export async function setProblemPracticeItem(id: number, itemId: number): Promise<void> {
  await db.update(problem_sets).set({ practice_item_id: itemId }).where(eq(problem_sets.id, id));
}

export async function deleteProblemSet(id: number): Promise<void> {
  await db.delete(problem_sets).where(eq(problem_sets.id, id));
}
