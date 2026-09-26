import { InvalidAiResponseError } from "../aiResponseValidation";
import { cleanConceptName } from "../conceptName";
import {
  TASK_KINDS,
  type CriterionResult,
  type ExamProfile,
  type MockExamTask,
  type RubricCriterion,
  type TaskKind,
  type TaskResult,
} from "./types";

// Checks and cleans the models' answers for the three exam calls.

const MAX_TASKS = 30;
const MAX_TEXT = 20_000;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function kind(value: unknown): TaskKind {
  return (TASK_KINDS as readonly string[]).includes(value as string) ? (value as TaskKind) : "other";
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function normalizeExamProfile(raw: unknown): ExamProfile {
  const r = obj(raw);
  const topics = (Array.isArray(r.topics) ? r.topics : [])
    .map((t) => ({ concept: cleanConceptName(obj(t).concept), share: num(obj(t).share, 0, 10_000, 0) }))
    .filter((t): t is { concept: string; share: number } => !!t.concept && t.share > 0);
  if (topics.length === 0) throw new InvalidAiResponseError("no topics");
  const total = topics.reduce((n, t) => n + t.share, 0);
  const tasks = (Array.isArray(r.tasks) ? r.tasks : []).slice(0, 25).flatMap((t) => {
    const o = obj(t);
    const title = str(o.title, 200);
    const concept = cleanConceptName(o.concept);
    if (!title || !concept) return [];
    const difficulty = Math.round(num(o.difficulty, 1, 3, 2)) as 1 | 2 | 3;
    return [{ title, concept, points: num(o.points, 0, 1000, 0), kind: kind(o.kind), difficulty }];
  });
  return {
    examCount: Math.round(num(r.examCount, 1, 100, 1)),
    durationMinutes: Math.round(num(r.durationMinutes, 15, 600, 180)),
    totalPoints: num(r.totalPoints, 1, 10_000, 100),
    style: str(r.style, 1500),
    language: str(r.language, 40) || "English",
    topics: topics.map((t) => ({ ...t, share: t.share / total })).sort((a, b) => b.share - a.share),
    tasks,
  };
}

// Rubric points are rescaled to add up to the task's points exactly (in
// half points), so grading can never exceed the task.
export function normalizeRubric(raw: unknown, taskPoints: number): RubricCriterion[] {
  const criteria = (Array.isArray(raw) ? raw : [])
    .map((c) => ({ criterion: str(obj(c).criterion, 500), points: num(obj(c).points, 0, 1000, 0) }))
    .filter((c) => c.criterion);
  if (criteria.length === 0) return [{ criterion: "Correct, complete answer", points: taskPoints }];
  const sum = criteria.reduce((n, c) => n + c.points, 0);
  const scaled = criteria.map((c) => ({
    ...c,
    points: sum > 0 ? roundHalf((c.points / sum) * taskPoints) : roundHalf(taskPoints / criteria.length),
  }));
  const drift = roundHalf(taskPoints - scaled.reduce((n, c) => n + c.points, 0));
  scaled[scaled.length - 1].points = Math.max(0, roundHalf(scaled[scaled.length - 1].points + drift));
  return scaled;
}

export function normalizeMockExam(raw: unknown): { title: string; tasks: MockExamTask[] } {
  const r = obj(raw);
  const tasks = (Array.isArray(r.tasks) ? r.tasks : []).slice(0, MAX_TASKS).flatMap((t) => {
    const o = obj(t);
    const prompt = str(o.prompt);
    if (!prompt) return [];
    const points = roundHalf(num(o.points, 0.5, 1000, 10));
    return [
      {
        title: str(o.title, 200) || prompt.slice(0, 60),
        prompt,
        points,
        concept: cleanConceptName(o.concept) ?? "General",
        kind: kind(o.kind),
        rubric: normalizeRubric(o.rubric, points),
        solution: str(o.solution),
      },
    ];
  });
  if (tasks.length === 0) throw new InvalidAiResponseError("no tasks");
  return { title: str(r.title, 200) || "Mock exam", tasks };
}

// Criteria are matched to the rubric by position; awarded points are
// clamped to each criterion's maximum (the rubric's, not the model's).
export function normalizeTaskGrading(raw: unknown, task: MockExamTask): TaskResult {
  const r = obj(raw);
  const given = Array.isArray(r.criteria) ? r.criteria : [];
  if (given.length === 0) throw new InvalidAiResponseError("no criteria");
  const criteria: CriterionResult[] = task.rubric.map((c, i) => {
    const g = obj(given[i]);
    return {
      criterion: c.criterion,
      awarded: roundHalf(num(g.awarded, 0, c.points, 0)),
      max: c.points,
      comment: str(g.comment, 1000),
    };
  });
  const points = criteria.reduce((n, c) => n + c.awarded, 0);
  const misconception = str(r.misconception, 500);
  const transcription = str(r.transcription);
  return {
    points,
    maxPoints: task.points,
    feedback: str(r.feedback, 2000),
    criteria,
    misconception: points < task.points && misconception && misconception !== "null" ? misconception : null,
    transcription: transcription && transcription !== "null" ? transcription : null,
  };
}
