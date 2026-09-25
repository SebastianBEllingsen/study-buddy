import { describe, it, expect } from "vitest";
import {
  descendantFolderIds,
  folderPathLabel,
  folderPathNames,
  foldersInTreeOrder,
  subtreeFolderIds,
  wouldCreateCycle,
} from "./folderTree";

// Tree:
//   1 Alpha
//     2 Beta
//       4 Delta
//         5 Epsilon
//     3 Gamma
//   6 Zeta
const folders = [
  { id: 1, name: "Alpha", parent_folder_id: null },
  { id: 2, name: "Beta", parent_folder_id: 1 },
  { id: 3, name: "Gamma", parent_folder_id: 1 },
  { id: 4, name: "Delta", parent_folder_id: 2 },
  { id: 5, name: "Epsilon", parent_folder_id: 4 },
  { id: 6, name: "Zeta", parent_folder_id: null },
];

describe("descendantFolderIds / subtreeFolderIds", () => {
  it("collects every level below a folder", () => {
    expect(descendantFolderIds(folders, 1).sort()).toEqual([2, 3, 4, 5]);
    expect(descendantFolderIds(folders, 2).sort()).toEqual([4, 5]);
    expect(descendantFolderIds(folders, 5)).toEqual([]);
  });

  it("subtree includes the folder itself first", () => {
    expect(subtreeFolderIds(folders, 4)).toEqual([4, 5]);
    expect(subtreeFolderIds(folders, 6)).toEqual([6]);
  });

  it("terminates on a malformed cyclic tree", () => {
    const cyclic = [
      { id: 1, parent_folder_id: 2 },
      { id: 2, parent_folder_id: 1 },
    ];
    expect(descendantFolderIds(cyclic, 1)).toEqual([2]);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects nesting into itself or any descendant", () => {
    expect(wouldCreateCycle(folders, 1, 1)).toBe(true);
    expect(wouldCreateCycle(folders, 1, 5)).toBe(true);
    expect(wouldCreateCycle(folders, 2, 4)).toBe(true);
  });

  it("allows nesting anywhere outside its own subtree", () => {
    expect(wouldCreateCycle(folders, 6, 5)).toBe(false);
    expect(wouldCreateCycle(folders, 4, 3)).toBe(false);
    expect(wouldCreateCycle(folders, 5, 1)).toBe(false);
  });
});

describe("folderPathNames / folderPathLabel", () => {
  it("lists names from the top-level ancestor down", () => {
    expect(folderPathNames(folders, 5)).toEqual(["Alpha", "Beta", "Delta", "Epsilon"]);
    expect(folderPathLabel(folders, 3)).toBe("Alpha / Gamma");
    expect(folderPathLabel(folders, 6)).toBe("Zeta");
  });

  it("stops at a missing parent", () => {
    expect(folderPathLabel([{ id: 9, name: "Orphan", parent_folder_id: 404 }], 9)).toBe("Orphan");
  });
});

describe("foldersInTreeOrder", () => {
  it("puts each folder right before its own subfolders, with depth", () => {
    expect(foldersInTreeOrder(folders).map(({ folder, depth }) => [folder.id, depth])).toEqual([
      [1, 0],
      [2, 1],
      [4, 2],
      [5, 3],
      [3, 1],
      [6, 0],
    ]);
  });

  it("keeps sibling order from the input", () => {
    const reordered = [folders[5], folders[2], folders[1], folders[0], folders[3], folders[4]];
    expect(foldersInTreeOrder(reordered).map(({ folder }) => folder.id)).toEqual([6, 1, 3, 2, 4, 5]);
  });

  it("treats a folder whose parent is missing as top-level, and never drops cyclic folders", () => {
    const odd = [
      { id: 1, parent_folder_id: 404 },
      { id: 2, parent_folder_id: 3 },
      { id: 3, parent_folder_id: 2 },
    ];
    const ids = foldersInTreeOrder(odd).map(({ folder }) => folder.id);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });
});
