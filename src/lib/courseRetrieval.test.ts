import { describe, expect, it } from "vitest";
import { selectCourseContext, tokenize, type CourseSection } from "./courseRetrieval";

function doc(title: string, body: string | null): CourseSection {
  return { kind: "document", title, header: `--- Document: ${title} (Unfiled) ---`, body };
}

// ~4k tokens each — enough that the course as a whole is over the "small" cutoff.
const filler = (word: string) => Array.from({ length: 600 }, (_, i) => `${word} filler sentence ${i} here.`).join("\n\n");

describe("tokenize", () => {
  it("lowercases, drops stopwords and 1-letter words, keeps digits", () => {
    expect(tokenize("What is the Merge Assert rule for topic 5?")).toEqual(["merge", "assert", "rule", "topic", "5"]);
  });
});

describe("selectCourseContext", () => {
  it("sends a small course in full", () => {
    const out = selectCourseContext([doc("a.pdf", "alpha text"), doc("b.pdf", "beta text")], "anything");
    expect(out).toContain("alpha text");
    expect(out).toContain("beta text");
  });

  const big = [
    doc("automata.pdf", `${filler("automata")}\n\nThe subset construction turns an NFA into a DFA.`),
    doc("programs.pdf", `${filler("programs")}\n\nMerge Assert combines two consecutive asserts into one.`),
    doc("scan.png", null),
  ];

  it("sends an outline plus only the relevant excerpt of a big course", () => {
    const out = selectCourseContext(big, "how does merge assert work?");
    expect(out).toContain("Merge Assert combines two consecutive asserts");
    expect(out).not.toContain("subset construction");
    expect(out).toContain("automata.pdf");
    expect(out).toContain("scan.png");
    expect(out.length).toBeLessThan(40_000);
  });

  it("sends no excerpts when nothing matches", () => {
    const out = selectCourseContext(big, "thanks, that makes sense");
    expect(out).toContain("No part of the course matched");
    expect(out).not.toContain("Merge Assert");
  });

  it("includes a document the message names", () => {
    const out = selectCourseContext(
      [doc("Lecture 4.pdf", "short lecture four body"), ...big],
      "summarize lecture 4"
    );
    expect(out).toContain("short lecture four body");
  });
});
