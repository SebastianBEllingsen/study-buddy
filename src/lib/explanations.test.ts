import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPLANATIONS } from "./explanations";

describe("hover explanations", () => {
  const entries = Object.entries(EXPLANATIONS) as [string, { text: string; shortcut?: string; ai?: boolean }][];

  it("are short full sentences", () => {
    for (const [id, e] of entries) {
      expect(e.text.length, id).toBeGreaterThan(15);
      expect(e.text.length, id).toBeLessThanOrEqual(140);
      expect(e.text, id).toMatch(/[.!?]$/);
      expect(e.text, id).toMatch(/^[A-Z"']/);
    }
  });

  it("use single-key shortcuts", () => {
    for (const [id, e] of entries) {
      if (e.shortcut !== undefined) expect(e.shortcut, id).toMatch(/^\S{1,6}$/);
    }
  });

  it("don't repeat each other", () => {
    const texts = entries.map(([, e]) => e.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("are each used by a button somewhere", () => {
    const source: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith(".tsx")) source.push(fs.readFileSync(full, "utf8"));
      }
    };
    walk(path.join(process.cwd(), "src/app"));
    walk(path.join(process.cwd(), "src/components"));
    const all = source.join("\n");
    for (const [id] of entries) {
      const prefix = id.slice(0, id.lastIndexOf("."));
      // Either named directly, or built from a prefix like `rating.${result}`.
      const used = all.includes(`"${id}"`) || all.includes(`\`${prefix}.\${`);
      expect(used, id).toBe(true);
    }
  });
});
