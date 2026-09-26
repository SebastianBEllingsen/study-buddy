import type { ExamProfile } from "./types";

// A stand-in exam profile for a course with no analysed past exams — a
// self-study course, say. The mock exam becomes a "skill check": a balanced
// test of the course's own topics, weighted by the study plan's chapters
// when there is one, else spread over the concepts practised so far, else
// left to the model to draw from the material. Pure and client-safe.

export const SKILL_CHECK_MINUTES = 60;
const MAX_TOPICS = 12;

export const SKILL_CHECK_STYLE =
  "A balanced mix of task kinds suited to the subject: short answers, explanations, worked problems — and, where the subject calls for it, writing or reading code. Each task stands on its own, gives the context it needs, and asks for reasoning or working where that shows understanding.";

export function topicProfile(input: {
  chapters: { title: string; estimated_minutes: number | null }[];
  concepts: string[];
  hasMaterial: boolean;
  language: string;
}): ExamProfile | null {
  let topics: { concept: string; share: number }[] = [];
  if (input.chapters.length) {
    const chapters = input.chapters.slice(0, MAX_TOPICS);
    const weights = chapters.map((c) => (c.estimated_minutes && c.estimated_minutes > 0 ? c.estimated_minutes : 60));
    const total = weights.reduce((a, b) => a + b, 0);
    topics = chapters.map((c, i) => ({ concept: c.title, share: weights[i] / total }));
  } else if (input.concepts.length) {
    const concepts = input.concepts.slice(0, MAX_TOPICS);
    topics = concepts.map((concept) => ({ concept, share: 1 / concepts.length }));
  } else if (!input.hasMaterial) {
    return null;
  }
  return {
    examCount: 0,
    durationMinutes: SKILL_CHECK_MINUTES,
    totalPoints: 100,
    style: SKILL_CHECK_STYLE,
    language: input.language,
    topics: topics.sort((a, b) => b.share - a.share),
    tasks: [],
  };
}

// No analysed past exams behind it.
export function isSkillCheckProfile(profile: ExamProfile): boolean {
  return profile.examCount === 0;
}
