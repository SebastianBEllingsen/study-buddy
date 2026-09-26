import { desc, eq } from "drizzle-orm";
import { code_sets, db } from "../db";
import { nowUtc } from "../time";
import { emptyCodeProgress, type CodeExercise, type CodeLanguage, type CodeProgress, type CodeSet } from "./types";

type Row = typeof code_sets.$inferSelect;

function toSet(row: Row): CodeSet {
  const exercises = (JSON.parse(row.content_json) as { exercises: CodeExercise[] }).exercises;
  const saved = JSON.parse(row.progress_json) as Partial<CodeProgress>[];
  return {
    id: row.id,
    course_id: row.course_id,
    chapter_id: row.chapter_id,
    title: row.title,
    language: row.language,
    exercises,
    progress: exercises.map((e, i) => ({ ...emptyCodeProgress(e.starter), ...saved[i] })),
    practice_item_id: row.practice_item_id,
    created_at: row.created_at,
  };
}

export async function createCodeSet(input: {
  courseId: number;
  chapterId: number | null;
  title: string;
  language: CodeLanguage;
  exercises: CodeExercise[];
}): Promise<CodeSet> {
  const now = nowUtc();
  const [row] = await db
    .insert(code_sets)
    .values({
      course_id: input.courseId,
      chapter_id: input.chapterId,
      title: input.title,
      language: input.language,
      content_json: JSON.stringify({ exercises: input.exercises }),
      progress_json: JSON.stringify(input.exercises.map((e) => emptyCodeProgress(e.starter))),
      created_at: now,
      updated_at: now,
    })
    .returning();
  return toSet(row);
}

export async function getCodeSet(id: number): Promise<CodeSet | null> {
  const [row] = await db.select().from(code_sets).where(eq(code_sets.id, id)).limit(1);
  return row ? toSet(row) : null;
}

export async function listCodeSets(courseId: number): Promise<CodeSet[]> {
  const rows = await db
    .select()
    .from(code_sets)
    .where(eq(code_sets.course_id, courseId))
    .orderBy(desc(code_sets.created_at), desc(code_sets.id));
  return rows.map(toSet);
}

export async function saveCodeProgress(id: number, progress: CodeProgress[]): Promise<void> {
  await db.update(code_sets).set({ progress_json: JSON.stringify(progress), updated_at: nowUtc() }).where(eq(code_sets.id, id));
}

export async function setCodePracticeItem(id: number, itemId: number): Promise<void> {
  await db.update(code_sets).set({ practice_item_id: itemId }).where(eq(code_sets.id, id));
}

export async function deleteCodeSet(id: number): Promise<void> {
  await db.delete(code_sets).where(eq(code_sets.id, id));
}
