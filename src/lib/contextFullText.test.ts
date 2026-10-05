import { describe, it, expect, vi } from "vitest";

const getCourse = vi.fn();
const listDocumentsForCourse = vi.fn();
const listFoldersForCourse = vi.fn();
const listNotesForCourse = vi.fn();
vi.mock("./models", () => ({
  getCourse: (...args: unknown[]) => getCourse(...args),
  getFolder: vi.fn(),
  listDocumentsForCourse: (...args: unknown[]) => listDocumentsForCourse(...args),
  listFoldersForCourse: (...args: unknown[]) => listFoldersForCourse(...args),
  listNotesForCourse: (...args: unknown[]) => listNotesForCourse(...args),
}));

const { buildFullCourseContextText } = await import("./context");

describe("buildFullCourseContextText", () => {
  it("lists documents followed by the course's notes, each with its folder", async () => {
    getCourse.mockResolvedValue({ id: 1, name: "Sample Course" });
    listFoldersForCourse.mockResolvedValue([{ id: 5, course_id: 1, name: "Week 1", parent_folder_id: null }]);
    listDocumentsForCourse.mockResolvedValue([
      { id: 1, filename: "slides.pdf", folder_id: 5, status: "extracted", extracted_text: "slide text" },
    ]);
    listNotesForCourse.mockResolvedValue([
      { id: 2, title: "Key ideas", folder_id: 5, markdown: "# Key ideas" },
      { id: 3, title: "Loose note", folder_id: null, markdown: "body" },
    ]);

    const { courseName, text } = await buildFullCourseContextText(1);

    expect(courseName).toBe("Sample Course");
    expect(text).toContain("--- Document: slides.pdf (Week 1) ---\nslide text");
    expect(text).toContain("--- Note: Key ideas (Week 1) ---\n# Key ideas");
    expect(text).toContain("--- Note: Loose note (Unfiled) ---\nbody");
    expect(text.indexOf("slides.pdf")).toBeLessThan(text.indexOf("Key ideas"));
  });
});
