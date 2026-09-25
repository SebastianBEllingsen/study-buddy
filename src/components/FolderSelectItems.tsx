import { SelectItem } from "@/components/ui/select";
import { foldersInTreeOrder } from "@/lib/folderTree";
import type { Folder } from "@/lib/models";

// A course's folders as <SelectItem>s in tree order — each folder followed
// by its own subfolders, indented one step per level so nested folders
// (which can share a name with a folder elsewhere) read in context. Pair
// with folderPathLabel for the trigger's selected-value text.
export function FolderSelectItems({
  folders,
  suffix,
}: {
  folders: Folder[];
  // Optional extra text after a folder's name, e.g. " (incl. subfolders)".
  suffix?: (folder: Folder) => string;
}) {
  return foldersInTreeOrder(folders).map(({ folder, depth }) => (
    <SelectItem
      key={folder.id}
      value={String(folder.id)}
      style={depth > 0 ? { paddingLeft: `${0.375 + depth}rem` } : undefined}
    >
      {folder.name}
      {suffix?.(folder) ?? ""}
    </SelectItem>
  ));
}
