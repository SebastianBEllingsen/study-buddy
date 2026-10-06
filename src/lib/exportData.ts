import {
  getCanvas,
  getChatConversation,
  listCanvasesForCourse,
  listChatConversations,
  listCourses,
  listDocumentsForCourse,
  listFlashcardReviewsForItem,
  listFoldersForCourse,
  listGeneratedItemsForCourse,
  listNotesForCourse,
  listQuizAttemptsForItem,
} from "@/lib/models";
import { listCodeSets } from "@/lib/code/store";
import { getExamProfile, getMockExam, listAttemptsForExam, listMockExams } from "@/lib/exams/store";
import { listExplainSessions } from "@/lib/explain/store";
import { listProblemSets } from "@/lib/problems/store";
import { listMistakes } from "@/lib/review/mistakes";
import { listReviewItemsForItem } from "@/lib/review/store";
import { getStudyPlanForCourse } from "@/lib/studyPlan/store";

// The data behind Settings → Storage → "Export all data": everything that is
// expensive to lose, as plain JSON. It leaves out what can be recreated
// cheaply or is only meaningful on this machine: on-disk file paths, the raw
// bytes of uploaded files (the student still has them), chat attachment
// payloads, and every key/token in the app's settings.
//
// A section that can't be read (a corrupt row, say) is skipped and named in
// `warnings` instead of failing the whole export — an export that only works
// when nothing is wrong is no safety net.

export const EXPORT_VERSION = 2;

// A large page for lists that take a limit — a course has a handful of
// explain sessions, never anywhere near this many.
const EXPLAIN_SESSION_LIMIT = 10_000;

export interface ExportPayload {
  app: "Study Buddy";
  exportVersion: number;
  exportedAt: string;
  courses: Record<string, unknown>[];
  chats: Record<string, unknown>[];
  warnings: string[];
}

export async function exportAllData(now = new Date()): Promise<ExportPayload> {
  const warnings: string[] = [];

  // Runs one section; on failure records which and carries on.
  async function section<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (err) {
      console.error(`Export: couldn't read ${label}:`, err);
      warnings.push(`${label} couldn't be read and is missing from this export`);
      return fallback;
    }
  }

  const courses = await listCourses();
  const exportedCourses: Record<string, unknown>[] = [];

  for (const course of courses) {
    const where = `course "${course.name}"`;
    const [folders, documents, items, notes, canvasSummaries, studyPlan, examProfile, mockExamSummaries, problemSets, codeSets, explainSessions, mistakes] =
      await Promise.all([
        section(`${where}: folders`, () => listFoldersForCourse(course.id), []),
        section(`${where}: documents`, () => listDocumentsForCourse(course.id), []),
        section(`${where}: generated items`, () => listGeneratedItemsForCourse(course.id), []),
        section(`${where}: notes`, () => listNotesForCourse(course.id), []),
        section(`${where}: canvases`, () => listCanvasesForCourse(course.id), []),
        section(`${where}: study plan`, async () => (await getStudyPlanForCourse(course.id)) ?? null, null),
        section(`${where}: past-exam analysis`, async () => (await getExamProfile(course.id)) ?? null, null),
        section(`${where}: mock exams`, () => listMockExams(course.id), []),
        section(`${where}: problem sets`, () => listProblemSets(course.id), []),
        section(`${where}: code exercises`, () => listCodeSets(course.id), []),
        section(`${where}: explain sessions`, () => listExplainSessions(course.id, EXPLAIN_SESSION_LIMIT), []),
        section(`${where}: mistakes`, () => listMistakes({ courseId: course.id, status: "all" }), []),
      ]);

    const generatedItems = await Promise.all(
      items.map(async (item) => {
        const label = `${where}: "${item.title}"`;
        const [quizAttempts, flashcardReviews, reviewSchedule] = await Promise.all([
          item.mode === "quiz" ? section(`${label} attempts`, () => listQuizAttemptsForItem(item.id), []) : [],
          item.mode === "flashcards" ? section(`${label} reviews`, () => listFlashcardReviewsForItem(item.id), []) : [],
          item.mode === "notes" ? [] : section(`${label} review schedule`, () => listReviewItemsForItem(item.id), []),
        ]);
        const { content_json, ...rest } = item;
        let content: unknown = null;
        try {
          content = JSON.parse(content_json);
        } catch {
          warnings.push(`${label} has unreadable content and is exported without it`);
        }
        return { ...rest, content, quizAttempts, flashcardReviews, reviewSchedule };
      })
    );

    const canvases = (
      await Promise.all(canvasSummaries.map((summary) => section(`${where}: canvas "${summary.title}"`, () => getCanvas(summary.id), undefined)))
    ).filter((canvas) => canvas !== undefined);

    const mockExams = (
      await Promise.all(
        mockExamSummaries.map((summary) =>
          section(
            `${where}: mock exam "${summary.title}"`,
            async () => ({ ...(await getMockExam(summary.id)), attempts: await listAttemptsForExam(summary.id) }),
            null
          )
        )
      )
    ).filter((exam) => exam !== null);

    exportedCourses.push({
      ...course,
      folders,
      documents: documents.map((doc) => ({
        id: doc.id,
        course_id: doc.course_id,
        folder_id: doc.folder_id,
        filename: doc.filename,
        extracted_text: doc.extracted_text,
        page_count: doc.page_count,
        char_count: doc.char_count,
        status: doc.status,
        trust: doc.trust,
        error_message: doc.error_message,
        created_at: doc.created_at,
      })),
      generatedItems,
      notes,
      canvases,
      studyPlan,
      examProfile,
      mockExams,
      problemSets,
      codeSets,
      explainSessions,
      mistakes,
    });
  }

  const conversations = await section("chat history", () => listChatConversations(), []);
  const chats = (
    await Promise.all(
      conversations.map((conversation) =>
        section(
          `chat "${conversation.title ?? conversation.id}"`,
          async () => {
            const found = await getChatConversation(conversation.id);
            if (!found) return null;
            return {
              ...found.conversation,
              messages: found.messages.map((message) => ({
                ...message,
                // Names only: pasted images and files are large and the
                // student still has them.
                attachments: (message.attachments ?? []).map((a) => ({ type: a.type, filename: a.filename, mimeType: a.mimeType })),
              })),
            };
          },
          null
        )
      )
    )
  ).filter((chat) => chat !== null);

  return {
    app: "Study Buddy",
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    courses: exportedCourses,
    chats,
    warnings,
  };
}
