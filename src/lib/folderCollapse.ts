// Which folders on a course page are collapsed — kept per browser in
// localStorage, one key per folder (and per section inside a folder).

// The key format is unchanged from before this module existed, so stored
// preferences keep working; a section suffix (e.g. "documents") namespaces
// a folder's sub-sections under the same folder.
export function collapseKey(folderId: number, section?: string): string {
  return section
    ? `studybuddy:folder:${folderId}:${section}:collapsed`
    : `studybuddy:folder:${folderId}:collapsed`;
}

// Fired on window whenever one folder is opened or closed, so the course
// page can update its single Expand all / Collapse all button.
export const FOLDER_TOGGLED_EVENT = "studybuddy:folder-toggled";

// Whether every folder is open. A folder with nothing stored is open (the
// default); "1" means collapsed.
export function areAllFoldersOpen(folderIds: number[], getItem: (key: string) => string | null): boolean {
  return folderIds.every((id) => getItem(collapseKey(id)) !== "1");
}
