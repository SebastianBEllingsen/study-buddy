import {
  listCourses,
  listFoldersForCourse,
  listDocumentsForCourse,
  listGeneratedItemsForCourse,
  listQuizAttemptsForItem,
  listFlashcardReviewsForItem,
  getFlashcardScheduleForItem,
} from "@/lib/models";

// A student-facing safety net, not a system backup: everything that's
// expensive to lose (course/folder structure, extracted document text, and
// every generated note/quiz/flashcard set with its full review/attempt
// history) as one downloadable JSON file. Deliberately excludes on-disk
// file paths (meaningless outside this machine) and raw PDF bytes (the
// student still has the source PDFs; re-uploading them is cheap, whereas
// the AI generations and review history are not).
export async function GET() {
  try {
    const courses = await listCourses();

    const exportedCourses = await Promise.all(
      courses.map(async (course) => {
        const [folders, documents, items] = await Promise.all([
          listFoldersForCourse(course.id),
          listDocumentsForCourse(course.id),
          listGeneratedItemsForCourse(course.id),
        ]);

        const generatedItems = await Promise.all(
          items.map(async (item) => {
            const [quizAttempts, flashcardReviews, flashcardSchedule] = await Promise.all([
              item.mode === "quiz" ? listQuizAttemptsForItem(item.id) : [],
              item.mode === "flashcards" ? listFlashcardReviewsForItem(item.id) : [],
              item.mode === "flashcards" ? getFlashcardScheduleForItem(item.id) : [],
            ]);
            const { content_json, ...rest } = item;
            return {
              ...rest,
              content: JSON.parse(content_json),
              quizAttempts,
              flashcardReviews,
              flashcardSchedule,
            };
          })
        );

        return {
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
            error_message: doc.error_message,
            created_at: doc.created_at,
          })),
          generatedItems,
        };
      })
    );

    const payload = {
      app: "Study Buddy",
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      courses: exportedCourses,
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="study-buddy-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    console.error("Export failed:", err);
    return Response.json({ error: "Couldn't export your data" }, { status: 500 });
  }
}
