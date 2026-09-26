import { describe, expect, it } from "vitest";
import { estimateTokens } from "../chunking";
import { buildMaterialDigest } from "./materialDigest";

const sample = [
  "# Sample Course notes",
  "Some introduction text that goes on for a while.",
  "1.2 Foundations",
  "Chapter 3 Methods",
  "Week 5: Applications",
  "This is an ordinary sentence and should not count as a heading because it has no number at the start.",
].join("\n");

describe("buildMaterialDigest", () => {
  it("lists each document with its headings and an opening excerpt", () => {
    const digest = buildMaterialDigest([{ filename: "notes.pdf", extracted_text: sample }]);
    expect(digest).toContain("--- Document: notes.pdf ---");
    expect(digest).toContain("- Sample Course notes");
    expect(digest).toContain("- 1.2 Foundations");
    expect(digest).toContain("- Chapter 3 Methods");
    expect(digest).toContain("- Week 5: Applications");
    expect(digest).not.toContain("- This is an ordinary sentence");
    expect(digest).toContain("Opening: # Sample Course notes");
  });

  it("stays within the token budget for a large course", () => {
    const docs = Array.from({ length: 200 }, (_, i) => ({
      filename: `doc-${i}.pdf`,
      extracted_text: Array.from({ length: 40 }, (_, j) => `${j + 1}. Heading number ${j} of document ${i}`).join("\n"),
    }));
    const digest = buildMaterialDigest(docs, 5000);
    expect(estimateTokens(digest)).toBeLessThanOrEqual(5000 + 200 * 10);
    // Every file is still named, so chapters can still be matched to it.
    expect(digest).toContain("doc-199.pdf");
  });

  it("is empty with no documents", () => {
    expect(buildMaterialDigest([])).toBe("");
  });
});
