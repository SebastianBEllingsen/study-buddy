import { generateStructured, getModelInfo } from "../aiClient";
import { getAppSettings, getCourse, listDocumentsForCourse } from "../models";
import { MAX_EXAMS_ANALYZED, examAnalysisSystemPrompt, examAnalysisUserPrompt } from "../prompts/exams";
import { saveExamProfile } from "./store";
import { pastExamRank } from "./detect";
export { looksLikePastExam } from "./detect";
import type { ExamProfile } from "./types";
import { normalizeExamProfile } from "./validate";

// Reads a course's past exams (documents the learner picks) and saves what
// they look like — the profile mock exams are written to match.

export class NoPastExamsError extends Error {
  constructor() {
    super("Pick at least one past exam from this course whose text could be extracted.");
    this.name = "NoPastExamsError";
  }
}

export async function analyzePastExams(courseId: number, documentIds: number[]): Promise<ExamProfile> {
  const wanted = new Set(documentIds);
  // Real exams before tests and quizzes when more are picked than fit;
  // newest-looking names (higher years sort later) first within each.
  const exams = (await listDocumentsForCourse(courseId))
    .filter((d) => wanted.has(d.id) && d.status === "extracted" && d.extracted_text?.trim())
    .sort((a, b) => pastExamRank(b.filename) - pastExamRank(a.filename) || b.filename.localeCompare(a.filename))
    .slice(0, MAX_EXAMS_ANALYZED);
  if (exams.length === 0) throw new NoPastExamsError();

  const [course, { aiEfficiencyMode: efficient }] = await Promise.all([getCourse(courseId), getAppSettings()]);
  const profile = normalizeExamProfile(
    await generateStructured<unknown>({
      system: examAnalysisSystemPrompt(course?.name ?? "this course"),
      user: examAnalysisUserPrompt(exams.map((d) => ({ filename: d.filename, text: d.extracted_text as string }))),
      maxTokens: efficient ? 4000 : 8000,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );
  await saveExamProfile({
    courseId,
    sourceDocumentIds: exams.map((d) => d.id),
    profile,
    model: await getModelInfo(efficient),
  });
  return profile;
}
