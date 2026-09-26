import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, explain_sessions } from "../db";
import { nowUtc } from "../time";
import type { ExplainKind, ExplainMessage, ExplainResult, ExplainSession } from "./types";

type Row = typeof explain_sessions.$inferSelect;

function toSession(row: Row): ExplainSession {
  return {
    id: row.id,
    course_id: row.course_id,
    chapter_id: row.chapter_id,
    kind: row.kind,
    topic: row.topic,
    status: row.status,
    messages: JSON.parse(row.messages_json) as ExplainMessage[],
    result: row.result_json ? (JSON.parse(row.result_json) as ExplainResult) : null,
    practice_item_id: row.practice_item_id,
    created_at: row.created_at,
  };
}

export async function createExplainSession(input: {
  courseId: number;
  chapterId: number | null;
  kind: ExplainKind;
  topic: string;
}): Promise<ExplainSession> {
  const now = nowUtc();
  const [row] = await db
    .insert(explain_sessions)
    .values({
      course_id: input.courseId,
      chapter_id: input.chapterId,
      kind: input.kind,
      topic: input.topic,
      status: "open",
      created_at: now,
      updated_at: now,
    })
    .returning();
  return toSession(row);
}

export async function getExplainSession(id: number): Promise<ExplainSession | null> {
  const [row] = await db.select().from(explain_sessions).where(eq(explain_sessions.id, id)).limit(1);
  return row ? toSession(row) : null;
}

export async function saveMessages(id: number, messages: ExplainMessage[]): Promise<void> {
  await db
    .update(explain_sessions)
    .set({ messages_json: JSON.stringify(messages), updated_at: nowUtc() })
    .where(eq(explain_sessions.id, id));
}

export async function finishExplainSession(id: number, result: ExplainResult, practiceItemId: number | null): Promise<void> {
  await db
    .update(explain_sessions)
    .set({ status: "done", result_json: JSON.stringify(result), practice_item_id: practiceItemId, updated_at: nowUtc() })
    .where(eq(explain_sessions.id, id));
}

export async function listExplainSessions(courseId: number, limit = 20): Promise<ExplainSession[]> {
  const rows = await db
    .select()
    .from(explain_sessions)
    .where(eq(explain_sessions.course_id, courseId))
    .orderBy(desc(explain_sessions.created_at), desc(explain_sessions.id))
    .limit(limit);
  return rows.map(toSession);
}

// The course's gap-card deck, if an earlier session made one.
export async function latestGapDeckId(courseId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: explain_sessions.practice_item_id })
    .from(explain_sessions)
    .where(and(eq(explain_sessions.course_id, courseId), isNotNull(explain_sessions.practice_item_id)))
    .orderBy(desc(explain_sessions.updated_at), desc(explain_sessions.id))
    .limit(1);
  return row?.id ?? null;
}
