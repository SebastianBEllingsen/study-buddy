import { generateStructured, getModelInfo } from "../aiClient";
import { getAppSettings, getCourse, listDocumentsForCourse } from "../models";
import { cleanConceptName, conceptKey } from "../conceptName";
import { MAX_EXAM_CHARS, mockExamSystemPrompt, mockExamUserPrompt } from "../prompts/exams";
import { buildMaterialDigest } from "../studyPlan/materialDigest";
import { getStudyPlanForCourse } from "../studyPlan/store";
import { listConceptsForCourse } from "../review/concepts";
import { loadCourseKnowledge } from "../review/knowledge";
import { createMockExam, getExamProfile, listMockExams } from "./store";
import type { MockExam } from "./types";
import { normalizeMockExam } from "./validate";
import { isSkillCheckProfile, topicProfile } from "./topicProfile";
import { languageName } from "../languages";

// Writes a new mock exam in the style of the course's past exams, leaning
// a little toward the concepts the learner currently recalls worst. With no
// analysed past exams, it writes a "skill check" of the course's topics
// instead (see topicProfile.ts).

export class NoExamProfileError extends Error {
  constructor() {
    super("There's nothing to test yet — add material or a study plan, practise some cards, or analyse past exams.");
    this.name = "NoExamProfileError";
  }
}

const MAX_FOCUS = 3;
const WEAK_RECALL = 0.6;

export async function generateMockExam(courseId: number, options: { durationMinutes?: number } = {}): Promise<MockExam> {
  const [stored, course, documents, plan, concepts, knowledge, existing, settings] = await Promise.all([
    getExamProfile(courseId),
    getCourse(courseId),
    listDocumentsForCourse(courseId),
    getStudyPlanForCourse(courseId),
    listConceptsForCourse(courseId),
    loadCourseKnowledge(courseId).catch(() => ({ concepts: [], untagged: 0 })),
    listMockExams(courseId),
    getAppSettings(),
  ]);
  const extracted = documents.filter((d) => d.status === "extracted" && d.extracted_text?.trim());
  const profile =
    stored?.profile ??
    topicProfile({
      chapters: [...(plan?.chapters ?? [])].sort((a, b) => a.position - b.position),
      concepts: concepts.map((c) => c.name),
      hasMaterial: extracted.length > 0,
      language: languageName(settings.preferredLanguage),
    });
  if (!profile) throw new NoExamProfileError();
  const skillCheck = isSkillCheckProfile(profile);
  const durationMinutes = options.durationMinutes ?? profile.durationMinutes;

  const known = [
    ...profile.topics.map((t) => t.concept),
    ...concepts.map((c) => c.name),
    ...(plan?.chapters.flatMap((c) => c.subtopics.map((s) => s.text)) ?? []),
  ]
    .map(cleanConceptName)
    .filter((n): n is string => !!n);
  const knownConcepts = [...new Map(known.map((n) => [conceptKey(n), n])).values()];
  const focus = knowledge.concepts
    .filter((c) => c.reviewed > 0 && c.recall < WEAK_RECALL)
    .slice(0, MAX_FOCUS)
    .map((c) => c.name);

  const pastExams = new Set(stored?.sourceDocumentIds ?? []);
  // A different past exam as the style sample each time.
  const samples = extracted.filter((d) => pastExams.has(d.id));
  const sample = samples.length ? samples[existing.length % samples.length] : null;
  const material = buildMaterialDigest(extracted.filter((d) => !pastExams.has(d.id)));

  const efficient = settings.aiEfficiencyMode;
  const exam = normalizeMockExam(
    await generateStructured<unknown>({
      system: mockExamSystemPrompt(course?.name ?? "this course", profile, { durationMinutes, knownConcepts, focus }),
      user: mockExamUserPrompt(
        skillCheck ? null : (sample?.extracted_text?.slice(0, MAX_EXAM_CHARS) ?? "(none available)"),
        material
      ),
      maxTokens: efficient ? 10_000 : 16_000,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );
  return createMockExam({
    courseId,
    title: `${skillCheck ? "Skill check" : "Mock exam"} ${existing.length + 1}`,
    durationMinutes,
    tasks: exam.tasks,
    model: await getModelInfo(efficient),
  });
}
