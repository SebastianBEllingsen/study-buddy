import { getGeneratedItem, createQuizAttempt, completeQuizAttempt, deleteQuizAttempt } from "@/lib/models";
import { describeAiError } from "@/lib/aiClient";
import { gradeQuizAnswers, scoreFromResults, type QuizAnswer } from "@/lib/quizGrading";
import { recordQuizAnswers } from "@/lib/review/answers";
import { isConfidence } from "@/lib/review/types";
import type { QuizContent } from "@/lib/types";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Quiz item not found" }, { status: 404 });
  // Set once the attempt row is created — used by the outer catch to roll
  // it back if anything after that point fails (most notably grading, which
  // makes a real API call and can be rate-limited). Without this, a failed
  // grading call left a permanent attempt with no score in "Previous
  // attempts" — see deleteQuizAttempt's own comment.
  let createdAttemptId: number | null = null;
  try {
    const item = await getGeneratedItem(id);
    if (!item || item.mode !== "quiz") {
      return Response.json({ error: "Quiz item not found" }, { status: 404 });
    }

    const body = await request.json();
    const answers: QuizAnswer[] = Array.isArray(body?.answers) ? body.answers : [];
    // Per-question confidence ("guess" | "unsure" | "sure"), tapped before
    // submitting; missing or unknown entries count as not given.
    const confidences: unknown[] = Array.isArray(body?.confidences) ? body.confidences : [];

    const content = JSON.parse(item.content_json) as QuizContent;
    const attempt = await createQuizAttempt(item.id);
    createdAttemptId = attempt.id;

    const results = await gradeQuizAnswers(
      content.questions.map((question, index) => ({ index, question, answer: answers[index] }))
    );
    const score = scoreFromResults(results);

    await completeQuizAttempt({ id: attempt.id, score, answersJson: results });

    // Spaced review and the mistake log. The attempt itself is already
    // saved, so a failure here is logged rather than failing the attempt.
    try {
      await recordQuizAnswers({
        item,
        entries: content.questions.map((question, index) => ({
          question,
          answer: answers[index],
          confidence: isConfidence(confidences[index]) ? confidences[index] : null,
          result: results[index],
        })),
        source: "quiz",
      });
    } catch (err) {
      console.error("Recording quiz answers for review failed:", err);
    }

    return Response.json({ attemptId: attempt.id, score, results });
  } catch (err) {
    if (createdAttemptId !== null) {
      await deleteQuizAttempt(createdAttemptId).catch(() => {});
    }
    console.error("Grading quiz attempt failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
