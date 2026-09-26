import { describe, expect, it } from "vitest";
import {
  MAX_SYLLABUS_CHARS,
  resourceSearchSystemPrompt,
  resourceSearchUserPrompt,
  studyPlanOutlineSystemPrompt,
  studyPlanOutlineUserPrompt,
  studyPlanReplanUserPrompt,
  studyPlanSupplementSystemPrompt,
  studyPlanSupplementUserPrompt,
} from "./studyPlan";

describe("study plan outline prompts", () => {
  it("makes the syllabus the authority when there is one", () => {
    const prompt = studyPlanOutlineSystemPrompt("Sample Course", "German", { hasSyllabus: true, hasMaterial: true });
    expect(prompt).toContain("Sample Course");
    expect(prompt).toMatch(/syllabus is the authority/i);
    expect(prompt).toContain("in German");
    expect(prompt).toMatch(/Exams, tests, practice sets, assignments, and course admin are not chapters/);
  });

  it("infers topics from material when there's no syllabus", () => {
    const prompt = studyPlanOutlineSystemPrompt("Sample Course", "English", { hasSyllabus: false, hasMaterial: true });
    expect(prompt).toMatch(/no syllabus/i);
    expect(prompt).not.toMatch(/syllabus is the authority/i);
  });

  it("includes the syllabus (capped) and the digest", () => {
    const user = studyPlanOutlineUserPrompt("x".repeat(MAX_SYLLABUS_CHARS + 500), "--- Document: a.pdf ---");
    expect(user).toContain("x".repeat(MAX_SYLLABUS_CHARS));
    expect(user).not.toContain("x".repeat(MAX_SYLLABUS_CHARS + 1));
    expect(user).toContain("--- Document: a.pdf ---");
  });
});

describe("resource search prompts", () => {
  it("asks for the configured count, language, and free resources only", () => {
    const system = resourceSearchSystemPrompt("Spanish", { min: 3, max: 5 }, true);
    expect(system).toContain("3–5 resources");
    expect(system).toContain("Prefer resources in Spanish");
    expect(system).toMatch(/Never link a store/);
    expect(system).toMatch(/Search the web/);
    expect(resourceSearchSystemPrompt("English", { min: 2, max: 3 }, false)).toMatch(/confident still exist/);
  });

  it("only carries short chapter fields, never long text", () => {
    const longSummary = "word ".repeat(2000);
    const user = resourceSearchUserPrompt("Sample Course", {
      title: "Chapter 1: Foundations",
      summary: longSummary,
      subtopics: ["Basics", "More basics"],
    });
    expect(user).toContain("Chapter 1: Foundations");
    expect(user).toContain("- Basics");
    expect(user.length).toBeLessThan(1000);
  });

  it("adds a note for chapters the student has seen or knows", () => {
    const base = { title: "T", summary: "", subtopics: [] };
    expect(resourceSearchUserPrompt("C", { ...base, level: "known" })).toMatch(/already knows this chapter/);
    expect(resourceSearchUserPrompt("C", { ...base, level: "familiar" })).toMatch(/met this material before/);
    expect(resourceSearchUserPrompt("C", { ...base, level: "new" })).not.toMatch(/already knows|met this material/);
  });

  it("asks the outline for study-time estimates", () => {
    expect(studyPlanOutlineSystemPrompt("C", "English", { hasSyllabus: true, hasMaterial: false })).toContain(
      '"estimatedMinutes"'
    );
  });

  it("lists URLs to exclude on a retry", () => {
    const user = resourceSearchUserPrompt("Sample Course", { title: "T", summary: "", subtopics: [] }, [
      "https://example.org/broken",
    ]);
    expect(user).toContain("- https://example.org/broken");
  });
});

describe("supplement and replan prompts", () => {
  it("numbers the current chapters and forbids changing them", () => {
    const user = studyPlanSupplementUserPrompt([{ title: "Foundations", subtopics: ["A"] }], "--- Document: new.pdf ---");
    expect(user).toContain("1. Foundations\n   - A");
    expect(user).toContain("--- Document: new.pdf ---");
    expect(studyPlanSupplementSystemPrompt("C", "English")).toMatch(/never rename, reorder or remove/);
  });

  it("describes each chapter's progress for replanning", () => {
    const user = studyPlanReplanUserPrompt(
      [
        { title: "A", masteryPercent: 40, level: null, complete: true, missedSessions: 2 },
        { title: "B", masteryPercent: null, level: "known", complete: false, missedSessions: 0 },
      ],
      null
    );
    expect(user).toContain("1. A — finished, mastery 40%, 2 missed sessions");
    expect(user).toContain("2. B — not finished, not tested yet, student said they know it");
    expect(user).toContain("No deadline.");
  });
});
