import { describe, it, expect } from "vitest";
import type { LinkTargets } from "./models";
import {
  headingSlug,
  newNoteHref,
  parseWikiLinks,
  resolveWikiLink,
  titleFromNewNoteHref,
  wikiLinksToTitle,
} from "./obsidianLinks";

const targets: LinkTargets = {
  notes: [
    { id: 5, title: "Custom PCB", courseId: 1, courseName: "Misc" },
    { id: 9, title: "Claude plan", courseId: 1, courseName: "Misc" },
  ],
  documents: [],
  items: [],
};

describe("parseWikiLinks", () => {
  it("parses plain, aliased, and heading links", () => {
    const md = "See [[Custom PCB]], [[Firmware|the firmware]] and [[Custom PCB#Power budget|power]].";
    expect(parseWikiLinks(md).map(({ target, heading, alias }) => ({ target, heading, alias }))).toEqual([
      { target: "Custom PCB", heading: undefined, alias: undefined },
      { target: "Firmware", heading: undefined, alias: "the firmware" },
      { target: "Custom PCB", heading: "Power budget", alias: "power" },
    ]);
  });

  it("parses a same-note heading link", () => {
    const [m] = parseWikiLinks("Jump to [[#Parts List]]");
    expect(m).toMatchObject({ target: "", heading: "Parts List", raw: "[[#Parts List]]", start: 8, end: 23 });
  });

  it("accepts an escaped alias pipe (as written inside a table cell)", () => {
    expect(parseWikiLinks("| [[Custom PCB\\|PCB]] |")[0]).toMatchObject({ target: "Custom PCB", alias: "PCB" });
  });

  it("leaves the app's own id links to noteLinks.ts", () => {
    expect(parseWikiLinks("[[note:12]] [[doc:3#x|y]] [[item:4]]")).toEqual([]);
  });

  it("skips embeds and code", () => {
    const md = "![[image.png]]\n`[[Inline]]`\n```\n[[Fenced]]\n```\n~~~md\n[[Tilde]]\n~~~\n[[Real]]";
    expect(parseWikiLinks(md).map((m) => m.target)).toEqual(["Real"]);
  });

  it("doesn't let a stray backtick hide links in a later paragraph", () => {
    expect(parseWikiLinks("A lone ` here\n\n[[After]] and `code`").map((m) => m.target)).toEqual(["After"]);
  });

  it("ignores empty brackets", () => {
    expect(parseWikiLinks("[[ ]] [[#]]")).toEqual([]);
  });
});

describe("headingSlug", () => {
  it.each([
    ["Parts List", "parts-list"],
    ["⌚ DIY Sleep Tracker Smartwatch", "diy-sleep-tracker-smartwatch"],
    ["1. Microcontroller", "1-microcontroller"],
    ["8. Small Stuff (~$15)", "8-small-stuff-15"],
    ["Lineær algebra", "lineær-algebra"],
    ["Later: Custom PCB Stage", "later-custom-pcb-stage"],
  ])("%s → %s", (text, slug) => {
    expect(headingSlug(text)).toBe(slug);
  });
});

describe("resolveWikiLink", () => {
  it("resolves by title, case-insensitively", () => {
    expect(resolveWikiLink({ target: "custom pcb" }, targets)).toEqual({
      href: "/vault/5",
      label: "custom pcb",
      missing: false,
    });
  });

  it("appends a heading fragment and labels it", () => {
    expect(resolveWikiLink({ target: "Custom PCB", heading: "Power Budget" }, targets)).toEqual({
      href: "/vault/5#power-budget",
      label: "Custom PCB › Power Budget",
      missing: false,
    });
  });

  it("prefers the alias as the label", () => {
    expect(resolveWikiLink({ target: "Custom PCB", alias: "PCB" }, targets).label).toBe("PCB");
  });

  it("keeps a same-note heading link as a bare fragment", () => {
    expect(resolveWikiLink({ target: "", heading: "Parts List" }, targets, 9)).toEqual({
      href: "#parts-list",
      label: "Parts List",
      missing: false,
    });
    expect(resolveWikiLink({ target: "Claude plan", heading: "Budget" }, targets, 9).href).toBe("#budget");
  });

  it("marks a link to a note that doesn't exist as missing", () => {
    expect(resolveWikiLink({ target: "Sleep Algorithm" }, targets)).toEqual({
      href: null,
      label: "Sleep Algorithm",
      missing: true,
    });
  });
});

describe("new-note hrefs", () => {
  it("round-trips a title", () => {
    const href = newNoteHref("Test Log #2");
    expect(href.startsWith("#wikilink-new:")).toBe(true);
    expect(titleFromNewNoteHref(href)).toBe("Test Log #2");
  });

  it("ignores other hrefs", () => {
    expect(titleFromNewNoteHref("#parts-list")).toBeNull();
    expect(titleFromNewNoteHref("#wikilink-new:%E0%A4%A")).toBeNull();
  });
});

describe("wikiLinksToTitle", () => {
  it("finds every name link to a title, case-insensitively", () => {
    const md = "[[Custom PCB]] and [[custom pcb#Stage|x]] but not [[Custom PCBs]] or [[note:5]]";
    expect(wikiLinksToTitle(md, "Custom PCB")).toHaveLength(2);
  });
});
