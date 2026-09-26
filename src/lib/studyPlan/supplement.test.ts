import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudyPlan } from "./types";

const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
  generateWithWebSearch: vi.fn(),
  backendSupportsWebSearch: vi.fn(),
}));

const listDocumentsForCourse = vi.fn();
const listFoldersForCourse = vi.fn();
vi.mock("../models", () => ({
  getAppSettings: async () => ({ aiEfficiencyMode: false, preferredLanguage: "en" }),
  getCourse: async () => ({ id: 1, name: "Sample Course" }),
  listDocumentsForCourse: (...a: unknown[]) => listDocumentsForCourse(...a),
  listFoldersForCourse: (...a: unknown[]) => listFoldersForCourse(...a),
}));

const findChapterResources = vi.fn();
vi.mock("./resources", async () => {
  const actual = await vi.importActual<typeof import("./resources")>("./resources");
  return { ...actual, findChapterResources: (...a: unknown[]) => findChapterResources(...a) };
});
const rescheduleQuietly = vi.fn();
vi.mock("./scheduleService", () => ({ rescheduleQuietly: (...a: unknown[]) => rescheduleQuietly(...a) }));

let plan: StudyPlan;
const extendChapter = vi.fn();
const createChapter = vi.fn();
const replaceAiResources = vi.fn();
const setPlanSourceDocumentIds = vi.fn();
vi.mock("./store", () => ({
  getStudyPlan: async () => plan,
  extendChapter: (...a: unknown[]) => extendChapter(...a),
  createChapter: (...a: unknown[]) => createChapter(...a),
  replaceAiResources: (...a: unknown[]) => replaceAiResources(...a),
  setPlanSourceDocumentIds: (...a: unknown[]) => setPlanSourceDocumentIds(...a),
}));

const { findNewPlanDocuments, supplementStudyPlan, NoNewMaterialError } = await import("./supplement");
const { PRESET_DEFAULTS } = await import("./options");

function makePlan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  const chapter = (id: number, position: number, stage: number, title: string) => ({
    id,
    plan_id: 1,
    position,
    stage,
    title,
    summary: "",
    subtopics: [{ text: "Existing idea", done: true }],
    prerequisite_ids: [],
    linked_document_ids: [],
    current_level: null,
    estimated_minutes: null,
    completed_at: null,
    created_at: "",
    updated_at: "",
    resources: [],
    items: [],
    mastery: null,
  });
  return {
    id: 1,
    course_id: 1,
    title: "Plan",
    status: "ready",
    preset: "roadmap",
    options: PRESET_DEFAULTS.roadmap,
    syllabus_document_id: 9,
    syllabus_text: null,
    source_document_ids: [10],
    source_folder_id: null,
    source_handpicked: false,
    language: "en",
    model_provider: null,
    model_name: null,
    used_web_search: false,
    error_message: null,
    links_checked_at: null,
    created_at: "",
    updated_at: "",
    chapters: [chapter(100, 0, 1, "Foundations"), chapter(101, 1, 2, "Methods")],
    sessions: [],
    ...overrides,
  };
}

const doc = (id: number, filename: string, folder_id: number | null = null, status = "extracted") => ({
  id,
  course_id: 1,
  folder_id,
  filename,
  status,
  extracted_text: `${filename} text`,
});

beforeEach(() => {
  vi.clearAllMocks();
  plan = makePlan();
  listDocumentsForCourse.mockResolvedValue([
    doc(9, "Syllabus.pdf"),
    doc(10, "Lecture1.pdf"),
    doc(11, "Lecture5.pdf", 3),
    doc(12, "Lecture6.pdf", 4),
    doc(13, "Broken.pdf", null, "failed"),
  ]);
  listFoldersForCourse.mockResolvedValue([
    { id: 3, parent_folder_id: null },
    { id: 4, parent_folder_id: null },
  ]);
  createChapter.mockImplementation(async (_planId: number, fields: { title: string }) => ({
    id: 200,
    title: fields.title,
    summary: "",
    subtopics: [],
  }));
  findChapterResources.mockResolvedValue({ resources: [{ url: "https://example.org/r" }], searched: true });
  generateStructured.mockResolvedValue({
    updates: [
      { chapter: 2, newSubtopics: ["New idea"], matchedDocuments: ["Lecture5.pdf", "Lecture1.pdf"] },
      { chapter: 9, newSubtopics: ["Nowhere"], matchedDocuments: [] },
    ],
    newChapters: [
      {
        title: "Applications",
        summary: "Using it.",
        subtopics: ["Use A"],
        prerequisites: [2],
        estimatedMinutes: 120,
        matchedDocuments: ["Lecture6.pdf"],
      },
    ],
  });
});

describe("findNewPlanDocuments", () => {
  it("finds extracted documents the plan hasn't seen, not the syllabus", async () => {
    expect((await findNewPlanDocuments(plan)).map((d) => d.id)).toEqual([11, 12]);
  });

  it("watches only the plan's folder (and subfolders) when it was built from one", async () => {
    plan = makePlan({ source_folder_id: 3 });
    expect((await findNewPlanDocuments(plan)).map((d) => d.id)).toEqual([11]);
  });
});

describe("supplementStudyPlan", () => {
  it("extends matching chapters and adds new ones after their prerequisites", async () => {
    const result = await supplementStudyPlan(1);
    expect(extendChapter).toHaveBeenCalledTimes(1);
    // Only new documents are linked — Lecture1 was already part of the plan.
    expect(extendChapter).toHaveBeenCalledWith(101, { subtopics: ["New idea"], documentIds: [11] });
    expect(createChapter).toHaveBeenCalledWith(1, {
      title: "Applications",
      summary: "Using it.",
      subtopics: ["Use A"],
      stage: 3,
      prerequisiteIds: [101],
      linkedDocumentIds: [12],
      estimatedMinutes: 120,
    });
    expect(replaceAiResources).toHaveBeenCalledWith(200, [{ url: "https://example.org/r" }]);
    expect(setPlanSourceDocumentIds).toHaveBeenCalledWith(1, [10, 11, 12]);
    expect(result).toMatchObject({ updatedChapters: 1, addedChapters: 1 });
    expect(rescheduleQuietly).not.toHaveBeenCalled();
  });

  it("sends only the new documents' outline, with the current chapters numbered", async () => {
    await supplementStudyPlan(1);
    const { user } = generateStructured.mock.calls[0][0];
    expect(user).toContain("1. Foundations");
    expect(user).toContain("2. Methods");
    expect(user).toContain("Lecture5.pdf");
    expect(user).not.toContain("Lecture1.pdf");
  });

  it("puts a new chapter with no prerequisites after the last stage, and reschedules a scheduled plan", async () => {
    plan = makePlan({ options: { ...PRESET_DEFAULTS.roadmap, schedule: true, webResources: false } });
    generateStructured.mockResolvedValue({
      updates: [],
      newChapters: [{ title: "Extra", subtopics: [], prerequisites: [], matchedDocuments: [] }],
    });
    await supplementStudyPlan(1);
    expect(createChapter.mock.calls[0][1]).toMatchObject({ stage: 3, prerequisiteIds: [] });
    expect(findChapterResources).not.toHaveBeenCalled();
    expect(rescheduleQuietly).toHaveBeenCalledWith(1);
  });

  it("refuses when there's nothing new", async () => {
    plan = makePlan({ source_document_ids: [10, 11, 12] });
    await expect(supplementStudyPlan(1)).rejects.toBeInstanceOf(NoNewMaterialError);
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
