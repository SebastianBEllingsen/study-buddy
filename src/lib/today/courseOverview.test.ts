import { describe, expect, it } from "vitest";
import { buildCourseRows, describeNextStep, lastStudiedAt } from "./courseOverview";
import { PRESET_DEFAULTS } from "../studyPlan/options";
import type { StudyPlan, StudyPlanChapter } from "../studyPlan/types";

function chapter(id: number, overrides: Partial<StudyPlanChapter> = {}): StudyPlanChapter {
  return {
    id,
    plan_id: 1,
    position: id,
    stage: id,
    title: `Chapter ${id}`,
    summary: "",
    subtopics: [{ text: "Idea", done: false }],
    prerequisite_ids: [],
    linked_document_ids: [],
    linked_note_ids: [],
    current_level: null,
    estimated_minutes: null,
    completed_at: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    resources: [],
    items: [],
    mastery: null,
    ...overrides,
  };
}

function plan(courseId: number, chapters: StudyPlanChapter[], overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: courseId * 10,
    course_id: courseId,
    title: "Plan",
    status: "ready",
    preset: "roadmap",
    options: PRESET_DEFAULTS.roadmap,
    syllabus_document_id: null,
    syllabus_text: null,
    source_document_ids: [],
    source_notes: {},
    source_folder_id: null,
    source_handpicked: false,
    language: "en",
    model_provider: null,
    model_name: null,
    used_web_search: false,
    error_message: null,
    links_checked_at: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    chapters,
    sessions: [],
    ...overrides,
  };
}

describe("lastStudiedAt", () => {
  it("is null for a plan nothing has been done in, however recently it was created", () => {
    expect(lastStudiedAt(plan(1, [chapter(1, { updated_at: "2026-05-01 00:00:00" })]))).toBeNull();
  });

  it("is the latest of ticked subtopics, finished resources, completed chapters and finished sessions", () => {
    const resource = { done_at: "2026-02-03 09:00:00" } as StudyPlanChapter["resources"][number];
    const p = plan(
      1,
      [
        chapter(1, { subtopics: [{ text: "a", done: true }], updated_at: "2026-02-01 09:00:00" }),
        chapter(2, { resources: [resource], completed_at: "2026-02-02 09:00:00" }),
      ],
      { sessions: [{ done_at: "2026-02-04 09:00:00" } as StudyPlan["sessions"][number]] }
    );
    expect(lastStudiedAt(p)).toBe("2026-02-04 09:00:00");
    expect(lastStudiedAt({ ...p, sessions: [] })).toBe("2026-02-03 09:00:00");
  });
});

describe("describeNextStep", () => {
  it("describes a resource, a subtopic and a quiz", () => {
    expect(describeNextStep({ type: "resource", resourceId: 1, title: "Intro lecture", kind: "video", url: "u", provider: null })).toBe(
      "Intro lecture"
    );
    expect(describeNextStep({ type: "subtopic", index: 0, text: "Sets" })).toBe("Sets");
    expect(describeNextStep({ type: "practice", itemId: null, itemTitle: null })).toBe("Test yourself");
    expect(describeNextStep({ type: "practice", itemId: 3, itemTitle: "Quiz", pretest: true })).toBe("Take the pre-test");
  });
});

describe("buildCourseRows", () => {
  const courses = [
    { id: 1, name: "Ready Course" },
    { id: 2, name: "Finished Course" },
    { id: 3, name: "Topics Course" },
    { id: 4, name: "Building Course" },
    { id: 5, name: "Failed Course" },
    { id: 6, name: "Stalled Course" },
    { id: 7, name: "Planless Course" },
  ];
  const now = new Date("2026-03-01T12:00:00Z");
  const status = (courseId: number, state: StudyPlan["status"], updated_at = "2026-03-01 11:59:00") => ({
    id: courseId * 10,
    course_id: courseId,
    status: state,
    updated_at,
  });

  const rows = buildCourseRows({
    courses,
    readyPlans: [
      plan(1, [chapter(1, { completed_at: "2026-02-01 00:00:00" }), chapter(2, { subtopics: [{ text: "Sets", done: false }] })]),
      plan(2, [chapter(3, { completed_at: "2026-02-01 00:00:00" })]),
    ],
    planStatuses: [
      status(1, "ready"),
      status(2, "ready"),
      status(3, "draft_topics"),
      status(4, "generating"),
      status(5, "failed"),
      status(6, "generating", "2026-02-01 00:00:00"),
    ],
    now,
  });
  const byCourse = (id: number) => rows.find((r) => r.courseId === id)!;

  it("keeps the course order and lists only courses that have a plan", () => {
    expect(rows.map((r) => r.courseId)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("shows a ready plan's progress and its next chapter", () => {
    expect(byCourse(1)).toMatchObject({
      state: "ready",
      progressPercent: 50,
      next: { chapterTitle: "Chapter 2", step: "Sets" },
    });
  });

  it("marks a fully finished plan as done, with a chapter to revise next", () => {
    expect(byCourse(2)).toMatchObject({ state: "done", next: { chapterTitle: "Chapter 3", step: "Test yourself" } });
  });

  it("tells unfinished plans apart, and leaves out a course with no plan", () => {
    expect(byCourse(3).state).toBe("setup");
    expect(byCourse(4).state).toBe("building");
    expect(byCourse(5).state).toBe("failed");
    expect(byCourse(6).state).toBe("failed");
    expect(rows.some((r) => r.courseId === 7)).toBe(false);
  });
});
