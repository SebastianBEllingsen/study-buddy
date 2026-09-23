import { describe, expect, it } from "vitest";
import {
  normalizeFolderChipSettings,
  parseFolderChipSettings,
  serializeFolderChipSettings,
  visibleFolderChips,
} from "./folderChips";

const all = ["documents", "generated", "notes", "subfolders"];

describe("visibleFolderChips", () => {
  it("shows every tag by default", () => {
    expect([...visibleFolderChips(null, null)]).toEqual(all);
  });

  it("hides individual tags from the global setting", () => {
    expect([...visibleFolderChips({ enabled: true, hidden: ["generated", "subfolders"] }, null)]).toEqual([
      "documents",
      "notes",
    ]);
  });

  it("turning tags off hides them all, whatever is hidden individually", () => {
    expect(visibleFolderChips({ enabled: false, hidden: [] }, null).size).toBe(0);
  });

  it("a course's own setting wins over the global one, in both directions", () => {
    expect(visibleFolderChips({ enabled: false, hidden: [] }, { enabled: true, hidden: ["notes"] }).has("notes")).toBe(false);
    expect(visibleFolderChips({ enabled: false, hidden: [] }, { enabled: true, hidden: ["notes"] }).size).toBe(3);
    expect(visibleFolderChips({ enabled: true, hidden: [] }, { enabled: false, hidden: [] }).size).toBe(0);
  });
});

describe("parsing and validation", () => {
  it("round-trips through the stored JSON", () => {
    const settings = { enabled: true, hidden: ["notes" as const] };
    expect(parseFolderChipSettings(serializeFolderChipSettings(settings))).toEqual(settings);
    expect(serializeFolderChipSettings(null)).toBeNull();
  });

  it("treats missing or broken stored values as unset", () => {
    expect(parseFolderChipSettings(null)).toBeNull();
    expect(parseFolderChipSettings("")).toBeNull();
    expect(parseFolderChipSettings("{oops")).toBeNull();
    expect(parseFolderChipSettings('{"enabled":"yes","hidden":[]}')).toBeNull();
  });

  it("drops unknown tag names and duplicates, keeping a stable order", () => {
    expect(normalizeFolderChipSettings({ enabled: true, hidden: ["subfolders", "bogus", "documents", "documents"] })).toEqual({
      enabled: true,
      hidden: ["documents", "subfolders"],
    });
  });
});
