import { describe, expect, it } from "vitest";
import { areAllFoldersOpen, collapseKey } from "./folderCollapse";

describe("collapseKey", () => {
  it("keeps the stored key format", () => {
    expect(collapseKey(4)).toBe("studybuddy:folder:4:collapsed");
    expect(collapseKey(4, "documents")).toBe("studybuddy:folder:4:documents:collapsed");
  });
});

describe("areAllFoldersOpen", () => {
  const store = (entries: Record<string, string>) => (key: string) => entries[key] ?? null;

  it("treats folders with nothing stored as open", () => {
    expect(areAllFoldersOpen([1, 2], store({}))).toBe(true);
  });

  it("is false once any folder is collapsed", () => {
    expect(areAllFoldersOpen([1, 2], store({ [collapseKey(2)]: "1" }))).toBe(false);
  });

  it("counts explicitly opened folders as open", () => {
    expect(areAllFoldersOpen([1, 2], store({ [collapseKey(1)]: "0", [collapseKey(2)]: "0" }))).toBe(true);
  });

  it("ignores section keys", () => {
    expect(areAllFoldersOpen([1], store({ [collapseKey(1, "documents")]: "1" }))).toBe(true);
  });

  it("is true with no folders", () => {
    expect(areAllFoldersOpen([], store({}))).toBe(true);
  });
});
