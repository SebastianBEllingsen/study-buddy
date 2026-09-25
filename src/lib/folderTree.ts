// Pure helpers for a course's folder tree. Folders nest to any depth via
// parent_folder_id; everything that needs "this folder and everything under
// it" (generation scope, staleness checks, delete, nesting validation, the
// course page's folder pickers) goes through here so they all agree on what
// a subtree is.
//
// Every walk tracks visited ids, so a malformed tree (a cycle that slipped
// in some other way) can't hang the caller — nestFolder itself refuses to
// create one (see wouldCreateCycle).

type TreeFolder = { id: number; parent_folder_id: number | null };

function childrenIndex<F extends TreeFolder>(folders: F[]): Map<number | null, F[]> {
  const byParent = new Map<number | null, F[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parent_folder_id);
    if (siblings) siblings.push(folder);
    else byParent.set(folder.parent_folder_id, [folder]);
  }
  return byParent;
}

// Every folder nested anywhere under folderId (not including folderId itself).
export function descendantFolderIds(folders: TreeFolder[], folderId: number): number[] {
  const byParent = childrenIndex(folders);
  const result: number[] = [];
  const seen = new Set<number>([folderId]);
  const stack = [folderId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

// folderId plus every folder nested under it.
export function subtreeFolderIds(folders: TreeFolder[], folderId: number): number[] {
  return [folderId, ...descendantFolderIds(folders, folderId)];
}

// True when making newParentId the parent of folderId would put folderId
// inside itself — newParentId is folderId or one of its own descendants.
export function wouldCreateCycle(folders: TreeFolder[], folderId: number, newParentId: number): boolean {
  return folderId === newParentId || descendantFolderIds(folders, folderId).includes(newParentId);
}

// Names from the top-level ancestor down to folderId, e.g. ["Tests", "Test 1"].
// Stops at a missing parent (or a cycle) rather than failing.
export function folderPathNames<F extends TreeFolder & { name: string }>(folders: F[], folderId: number): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parent_folder_id != null ? byId.get(current.parent_folder_id) : undefined;
  }
  return names;
}

export function folderPathLabel<F extends TreeFolder & { name: string }>(folders: F[], folderId: number): string {
  return folderPathNames(folders, folderId).join(" / ");
}

// Depth-first flattening for pickers: each folder followed by its own
// subfolders, siblings kept in the input order (callers pass folders
// already sorted by position). A folder whose parent isn't in the list is
// treated as top-level so it never disappears from a picker.
export function foldersInTreeOrder<F extends TreeFolder>(folders: F[]): { folder: F; depth: number }[] {
  const ids = new Set(folders.map((f) => f.id));
  const byParent = new Map<number | null, F[]>();
  for (const folder of folders) {
    const parent = folder.parent_folder_id != null && ids.has(folder.parent_folder_id) ? folder.parent_folder_id : null;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(folder);
    else byParent.set(parent, [folder]);
  }
  const result: { folder: F; depth: number }[] = [];
  const seen = new Set<number>();
  const visit = (parent: number | null, depth: number) => {
    for (const folder of byParent.get(parent) ?? []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      result.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  // Anything only reachable through a cycle — still list it rather than drop it.
  for (const folder of folders) {
    if (!seen.has(folder.id)) {
      seen.add(folder.id);
      result.push({ folder, depth: 0 });
      visit(folder.id, 1);
    }
  }
  return result;
}
