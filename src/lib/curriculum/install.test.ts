import { describe, it, expect, vi } from "vitest";
import type { TestDb } from "../db/testHarness";

// Same setup as studyPlan/store.test.ts: "../db" is a throwaway in-memory
// SQLite database bootstrapped with the production schema.
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { installCurriculum } = await import("./install");
const { getStudyPlanForCourse } = await import("../studyPlan/store");
const { PROGRAMMING_CURRICULUM } = await import("./programming");

describe("installCurriculum", () => {
  it("creates the course with a ready plan, prerequisites resolved to real chapters", async () => {
    const { courseId, alreadyInstalled } = await installCurriculum("programming");
    expect(alreadyInstalled).toBe(false);
    const plan = await getStudyPlanForCourse(courseId);
    expect(plan?.status).toBe("ready");
    // Set up like any other plan: roadmap preset, practice on, unscheduled (a
    // scheduled plan with no sessions yet would show nothing in Today) — plus the coding marker.
    expect(plan?.options).toMatchObject({ preset: "roadmap", schedule: false, topicLevels: false, practice: true, codeLanguage: "cpp" });
    expect(plan?.chapters).toHaveLength(PROGRAMMING_CURRICULUM.chapters.length);
    const concurrency = plan!.chapters.find((c) => c.title === "Concurrency")!;
    const ids = new Set(plan!.chapters.map((c) => c.id));
    expect(concurrency.prerequisite_ids.length).toBe(2);
    for (const p of concurrency.prerequisite_ids) expect(ids.has(p)).toBe(true);
    expect(concurrency.resources.every((r) => r.origin === "user")).toBe(true);
  });

  it("is idempotent: a second install keeps the existing course and its progress", async () => {
    const first = await installCurriculum("programming");
    const second = await installCurriculum("programming");
    expect(second).toEqual({ courseId: first.courseId, alreadyInstalled: true });
  });
});
