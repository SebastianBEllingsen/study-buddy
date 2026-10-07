import { describe, expect, it } from "vitest";
import { curriculumChapters, prerequisiteIndexes } from "./chapters";
import { PROGRAMMING_CURRICULUM } from "./programming";

const { chapters } = PROGRAMMING_CURRICULUM;

describe("programming curriculum", () => {
  it("has unique, non-empty titles and real content in every chapter", () => {
    expect(new Set(chapters.map((c) => c.title)).size).toBe(chapters.length);
    for (const c of chapters) {
      expect(c.summary.length, c.title).toBeGreaterThan(20);
      expect(c.subtopics.length, c.title).toBeGreaterThanOrEqual(5);
      expect(c.estimatedMinutes, c.title).toBeGreaterThan(0);
    }
  });

  it("only names earlier chapters as prerequisites, with no duplicates", () => {
    // Throws on an unknown title or one that doesn't come first.
    const indexes = prerequisiteIndexes(PROGRAMMING_CURRICULUM);
    indexes.forEach((list, i) => {
      for (const p of list) expect(p, chapters[i].title).toBeLessThan(i);
      expect(new Set(list).size, chapters[i].title).toBe(list.length);
    });
  });

  it("rejects a prerequisite that is unknown or comes later", () => {
    const base = PROGRAMMING_CURRICULUM.chapters;
    const withBad = (prerequisites: string[]) => ({
      ...PROGRAMMING_CURRICULUM,
      chapters: [{ ...base[0], prerequisites }, base[1]],
    });
    expect(() => prerequisiteIndexes(withBad(["No such chapter"]))).toThrow(/unknown chapter/);
    expect(() => prerequisiteIndexes(withBad([base[1].title]))).toThrow(/doesn't come before/);
  });

  it("teaches reading code and learning a library from its source", () => {
    const at = (title: string) => chapters.findIndex((c) => c.title === title);
    const nav = at("Reading documentation and navigating source code");
    const lib = at("Learning a library from its source");
    expect(nav).toBeGreaterThan(-1);
    // Navigation comes right after the toolchain, long before any real library work.
    expect(nav).toBeLessThan(at("Variables, types, operators and I/O"));
    expect(lib).toBeGreaterThan(nav);
    expect(chapters[nav].subtopics.join(" ")).toMatch(/go to definition/i);
    expect(chapters[lib].subtopics.join(" ")).toMatch(/public headers/i);
  });

  it("wires the prerequisites it means to (guards against index drift)", () => {
    const at = (title: string) => chapters.findIndex((c) => c.title === title);
    const requires = (title: string, ...needs: string[]) => {
      for (const n of needs) expect(chapters[at(title)].prerequisites, title).toContain(n);
    };
    requires("Ownership, RAII and smart pointers", "References, pointers and the stack vs the heap");
    requires("Concurrency", "Operating systems", "Move semantics and the rule of 0/3/5");
    requires("Software architecture", "Design patterns that matter", "API and interface design");
    requires("System design", "Distributed systems", "Software architecture");
    requires(
      "Capstone projects",
      "Domain modelling and design docs",
      "Concurrency",
      "Compilers and interpreters",
      "Persistence, files and serialization",
      "Performance engineering"
    );
    expect(chapters.at(-1)?.title).toBe("Capstone projects");
  });

  it("only links to https resources, each used once per chapter", () => {
    for (const c of chapters) {
      const urls = c.resources.map((r) => r.url);
      for (const u of urls) expect(u, c.title).toMatch(/^https:\/\//);
      expect(new Set(urls).size, c.title).toBe(urls.length);
    }
  });

  it("turns into plan chapters whose stages respect prerequisites", () => {
    const plan = curriculumChapters(PROGRAMMING_CURRICULUM);
    expect(plan).toHaveLength(chapters.length);
    plan.forEach((c, i) => {
      expect(c.title).toBe(chapters[i].title);
      for (const p of c.prerequisites) expect(c.stage, c.title).toBeGreaterThan(plan[p].stage);
      expect(c.summary).toContain(chapters[i].part);
    });
    // The first chapter has nothing before it.
    expect(plan[0].stage).toBe(1);
  });
});
