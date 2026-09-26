import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LinkCheckResult, LinkToCheck } from "../linkVerifier";
import type { NewResource, NewStudyPlan } from "./store";
import type { ChapterLevel, StudyPlan, StudyPlanStatus } from "./types";

const generateStructured = vi.fn();
const generateWithWebSearch = vi.fn();
const backendSupportsWebSearch = vi.fn();
vi.mock("../aiClient", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
  generateWithWebSearch: (...a: unknown[]) => generateWithWebSearch(...a),
  backendSupportsWebSearch: () => backendSupportsWebSearch(),
  getModelInfo: async () => ({ provider: "api", model: "test-model" }),
}));

const buildCourseContext = vi.fn();
vi.mock("../context", () => ({ buildCourseContext: (...a: unknown[]) => buildCourseContext(...a) }));

const getDocument = vi.fn();
const listDocumentsForCourse = vi.fn();
vi.mock("../models", () => ({
  getAppSettings: async () => ({ aiEfficiencyMode: false, preferredLanguage: "de" }),
  getDocument: (...a: unknown[]) => getDocument(...a),
  listDocumentsForCourse: (...a: unknown[]) => listDocumentsForCourse(...a),
  getCourse: async () => ({ id: 1, name: "Sample Course" }),
}));

// A tiny in-memory stand-in for ./store: enough to follow a plan from
// replaceStudyPlan through the resource step.
let saved: NewStudyPlan | null = null;
let current: StudyPlan | null = null;
const statuses: { status: StudyPlanStatus; extra: Record<string, unknown> }[] = [];
const resourcesByChapter = new Map<number, NewResource[]>();
const levelsSet: Map<number, ChapterLevel>[] = [];
let failLevels = false;

function toPlan(plan: NewStudyPlan): StudyPlan {
  return {
    id: 1,
    course_id: plan.courseId,
    title: plan.title,
    status: plan.status,
    preset: plan.options.preset,
    options: plan.options,
    syllabus_document_id: plan.syllabusDocumentId,
    syllabus_text: plan.syllabusText,
    source_document_ids: plan.sourceDocumentIds,
    source_folder_id: plan.sourceFolderId,
    source_handpicked: plan.sourceHandpicked,
    language: plan.language,
    model_provider: plan.modelProvider,
    model_name: plan.modelName,
    used_web_search: plan.usedWebSearch,
    error_message: null,
    links_checked_at: plan.linksCheckedAt,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    chapters: plan.chapters.map((c, i) => ({
      id: 100 + i,
      plan_id: 1,
      position: i,
      stage: c.stage,
      title: c.title,
      summary: c.summary,
      subtopics: c.subtopics.map((text) => ({ text, done: false })),
      prerequisite_ids: c.prerequisites.map((p) => 100 + p),
      linked_document_ids: c.linked_document_ids,
      current_level: null,
      estimated_minutes: c.estimated_minutes,
      completed_at: null,
      created_at: "",
      updated_at: "",
      resources: [],
      items: [],
      mastery: null,
    })),
    sessions: [],
  };
}

vi.mock("./store", () => ({
  replaceStudyPlan: async (plan: NewStudyPlan) => {
    saved = plan;
    current = toPlan(plan);
    return current;
  },
  getStudyPlan: async () => current,
  getChapter: vi.fn(),
  setChapterLevels: async (_planId: number, levels: Map<number, ChapterLevel>) => {
    if (failLevels) throw new Error("database unavailable");
    levelsSet.push(levels);
  },
  setPlanStatus: async (_id: number, status: StudyPlanStatus, extra: Record<string, unknown> = {}) => {
    statuses.push({ status, extra });
    if (current) current = { ...current, status };
  },
  replaceAiResources: async (chapterId: number, resources: NewResource[]) => {
    resourcesByChapter.set(chapterId, resources);
  },
  setPlanLinksCheckedAt: vi.fn(),
  setResourceLinkCheck: vi.fn(),
}));

// Link checks scripted per URL: anything with "dead" in it is dead.
const verifyLinks = vi.fn(async (links: LinkToCheck[]) => {
  const results = new Map<string, LinkCheckResult>();
  for (const l of links) {
    results.set(`${l.kind} ${l.url}`, {
      status: l.url.includes("dead") ? "dead" : "ok",
      detail: null,
      finalUrl: l.url.replace("redirect.example", "final.example"),
    });
  }
  return results;
});
vi.mock("../linkVerifier", async () => {
  const actual = await vi.importActual<typeof import("../linkVerifier")>("../linkVerifier");
  return { ...actual, verifyLinks: (links: LinkToCheck[]) => verifyLinks(links) };
});

const { createStudyPlanForCourse, buildPlanResources, matchDocumentIds, NoCurriculumError, SyllabusNotFoundError } =
  await import("./generatePlan");
const { DEFAULT_STUDY_PLAN_OPTIONS, PRESET_DEFAULTS } = await import("./options");

const DOCS = [
  { id: 10, course_id: 1, filename: "Lecture1.pdf", status: "extracted", extracted_text: "1. Foundations\nIntro" },
  { id: 11, course_id: 1, filename: "Lecture2.pdf", status: "extracted", extracted_text: "2. Methods\nMore" },
  { id: 12, course_id: 1, filename: "Syllabus.pdf", status: "extracted", extracted_text: "Week 1 Foundations" },
];

const OUTLINE = {
  title: "Sample plan",
  chapters: [
    {
      title: "Foundations",
      summary: "The basics.",
      subtopics: ["Idea A"],
      prerequisites: [],
      stage: 1,
      estimatedMinutes: 300,
      matchedDocuments: ["lecture1.pdf", "NotInScope.pdf"],
    },
    { title: "Methods", summary: "", subtopics: [], prerequisites: [1], stage: 1, matchedDocuments: ["Lecture2.pdf"] },
  ],
};

function searchResult(urls: string[]) {
  return {
    text: JSON.stringify({ resources: urls.map((url) => ({ kind: "article", title: url, url, note: "why" })) }),
    citations: [],
    searched: true,
  };
}

const allUrls = () => [...resourcesByChapter.values()].flat().map((r) => r.url);

beforeEach(() => {
  vi.clearAllMocks();
  saved = null;
  current = null;
  statuses.length = 0;
  levelsSet.length = 0;
  failLevels = false;
  resourcesByChapter.clear();
  buildCourseContext.mockResolvedValue({
    courseName: "Sample Course",
    documentIds: [10, 11, 12],
    folderId: null,
    handpicked: false,
  });
  listDocumentsForCourse.mockResolvedValue(DOCS);
  getDocument.mockImplementation(async (id: number) => DOCS.find((d) => d.id === id));
  generateStructured.mockResolvedValue(OUTLINE);
  backendSupportsWebSearch.mockResolvedValue(true);
  generateWithWebSearch.mockResolvedValue(
    searchResult(["https://example.org/1", "https://example.org/2", "https://example.org/3"])
  );
});

describe("matchDocumentIds", () => {
  it("maps filenames case-insensitively and drops unknown ones", () => {
    expect(matchDocumentIds(["LECTURE1.PDF", "other.pdf", "Lecture1.pdf"], DOCS)).toEqual([10]);
  });
});

describe("createStudyPlanForCourse", () => {
  it("saves chapters from the outline, with stages fixed to respect prerequisites", async () => {
    await createStudyPlanForCourse(1, { syllabus: { documentId: 12 }, options: DEFAULT_STUDY_PLAN_OPTIONS });
    expect(saved?.syllabusDocumentId).toBe(12);
    expect(saved?.syllabusText).toBeNull();
    expect(saved?.language).toBe("de");
    expect(saved?.chapters.map((c) => c.stage)).toEqual([1, 2]);
    expect(saved?.chapters[1].prerequisites).toEqual([0]);
    expect(saved?.chapters.map((c) => c.estimated_minutes)).toEqual([300, null]);
    // Only in-scope filenames map to ids; the syllabus itself isn't material.
    expect(saved?.chapters[0].linked_document_ids).toEqual([10]);
    expect(saved?.chapters[1].linked_document_ids).toEqual([11]);
    expect(saved?.sourceDocumentIds).toEqual([10, 11]);
  });

  it("goes straight on to find resources and marks the plan ready", async () => {
    const plan = await createStudyPlanForCourse(1, { syllabus: { text: "x" }, options: DEFAULT_STUDY_PLAN_OPTIONS });
    expect(saved?.status).toBe("generating");
    expect(statuses.at(-1)).toMatchObject({ status: "ready", extra: { usedWebSearch: true } });
    expect(plan.status).toBe("ready");
    expect(resourcesByChapter.get(100)?.map((r) => r.url)).toEqual([
      "https://example.org/1",
      "https://example.org/2",
      "https://example.org/3",
    ]);
  });

  it("stops at the outline when the user wants to mark what they know first", async () => {
    const plan = await createStudyPlanForCourse(1, { syllabus: { text: "x" }, options: PRESET_DEFAULTS.guided });
    expect(plan.status).toBe("draft_topics");
    expect(generateWithWebSearch).not.toHaveBeenCalled();
    expect(statuses).toHaveLength(0);
  });

  it("writes the plan in the preferred language and uses the syllabus as the authority", async () => {
    await createStudyPlanForCourse(1, { syllabus: { text: "1. Foundations" }, options: DEFAULT_STUDY_PLAN_OPTIONS });
    const { system, user } = generateStructured.mock.calls[0][0];
    expect(system).toContain("German");
    expect(system).toMatch(/syllabus is the authority/i);
    expect(user).toContain("1. Foundations");
    expect(saved?.syllabusText).toBe("1. Foundations");
  });

  it("never sends document text to the search-enabled call", async () => {
    await createStudyPlanForCourse(1, { syllabus: { text: "SECRET SYLLABUS BODY" }, options: DEFAULT_STUDY_PLAN_OPTIONS });
    for (const [params] of generateWithWebSearch.mock.calls) {
      expect(params.user).not.toContain("SECRET SYLLABUS BODY");
      expect(params.user).not.toContain("Intro");
    }
  });

  it("drops dead links, stores final URLs, and asks once more when too few survive", async () => {
    generateWithWebSearch
      .mockResolvedValueOnce(searchResult(["https://dead.example/1", "https://redirect.example/2", "https://dead.example/3"]))
      .mockResolvedValueOnce(searchResult(["https://example.org/4", "https://example.org/5", "https://example.org/9"]))
      .mockResolvedValue(searchResult(["https://example.org/6", "https://example.org/7", "https://example.org/8"]));
    await createStudyPlanForCourse(1, { syllabus: { text: "x" }, options: DEFAULT_STUDY_PLAN_OPTIONS });

    // Chapters search concurrently, so find the retry by its content: the
    // first chapter's second call, with its rejects excluded.
    const calls = generateWithWebSearch.mock.calls.map(([params]) => params.user as string);
    const retries = calls.filter((u) => u.includes("Do not suggest"));
    expect(retries).toHaveLength(1);
    expect(retries[0]).toContain("Chapter: Foundations");
    expect(retries[0]).toContain("https://dead.example/1");

    expect(allUrls()).not.toContain("https://dead.example/1");
    expect(allUrls()).toContain("https://final.example/2");
  });

  it("makes no web calls when resources are turned off", async () => {
    await createStudyPlanForCourse(1, {
      syllabus: { text: "x" },
      options: { ...DEFAULT_STUDY_PLAN_OPTIONS, webResources: false },
    });
    expect(generateWithWebSearch).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ status: "ready", extra: { linksCheckedAt: null } });
  });

  it("finishes the plan even when one chapter's search fails", async () => {
    generateWithWebSearch.mockRejectedValueOnce(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await createStudyPlanForCourse(1, { syllabus: { text: "x" }, options: DEFAULT_STUDY_PLAN_OPTIONS });
    expect(resourcesByChapter.size).toBe(1);
    expect(statuses.at(-1)?.status).toBe("ready");
  });

  it("rejects a syllabus document from another course", async () => {
    getDocument.mockResolvedValueOnce({ ...DOCS[2], course_id: 2 });
    await expect(
      createStudyPlanForCourse(1, { syllabus: { documentId: 12 }, options: DEFAULT_STUDY_PLAN_OPTIONS })
    ).rejects.toBeInstanceOf(SyllabusNotFoundError);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("needs a syllabus or some material", async () => {
    buildCourseContext.mockResolvedValueOnce({ courseName: "Sample Course", documentIds: [], folderId: null, handpicked: false });
    await expect(
      createStudyPlanForCourse(1, { syllabus: null, options: DEFAULT_STUDY_PLAN_OPTIONS })
    ).rejects.toBeInstanceOf(NoCurriculumError);
  });
});

describe("buildPlanResources", () => {
  async function draft() {
    await createStudyPlanForCourse(1, { syllabus: { text: "x" }, options: PRESET_DEFAULTS.guided });
  }

  it("records the levels and gives a known chapter a single refresher", async () => {
    await draft();
    await buildPlanResources(1, new Map<number, ChapterLevel>([[100, "known"], [101, "familiar"]]));
    expect(levelsSet[0]).toEqual(new Map([[100, "known"], [101, "familiar"]]));

    const calls = generateWithWebSearch.mock.calls.map(([params]) => params as { system: string; user: string });
    const known = calls.find((c) => c.user.includes("Chapter: Foundations"));
    const familiar = calls.find((c) => c.user.includes("Chapter: Methods"));
    expect(known?.system).toContain("1–1 resources");
    expect(known?.user).toMatch(/already knows this chapter/);
    expect(familiar?.user).toMatch(/met this material before/);
    expect(resourcesByChapter.get(100)).toHaveLength(1);
    expect(resourcesByChapter.get(101)).toHaveLength(3);
  });

  it("marks the plan failed with the reason when something unexpected stops it", async () => {
    await draft();
    failLevels = true;
    await expect(buildPlanResources(1, new Map())).rejects.toThrow("database unavailable");
    expect(statuses.at(-1)).toEqual({ status: "failed", extra: { errorMessage: "database unavailable" } });
  });
});
