// The count tags after a folder's name on a course page — how many
// documents, generated items, notes and subfolders it holds. Which ones
// show is a global setting (Settings → Display), and a course can override
// it with its own (Customize course). Stored as JSON text: app_settings.
// folder_chips and courses.folder_chips, null meaning "the default" and
// "follow the global setting" respectively.

export const FOLDER_CHIPS = ["documents", "generated", "notes", "subfolders"] as const;
export type FolderChip = (typeof FOLDER_CHIPS)[number];

export const FOLDER_CHIP_LABELS: Record<FolderChip, string> = {
  documents: "Documents",
  generated: "Generated",
  notes: "Notes",
  subfolders: "Subfolders",
};

export interface FolderChipSettings {
  // Off hides every tag, whatever `hidden` says.
  enabled: boolean;
  hidden: FolderChip[];
}

export const DEFAULT_FOLDER_CHIPS: FolderChipSettings = { enabled: true, hidden: [] };

// Validates an API body or a parsed column value. Unknown chip names are
// dropped rather than rejected, so an older client can't be locked out by a
// chip it doesn't know about; anything not shaped like settings is null.
export function normalizeFolderChipSettings(value: unknown): FolderChipSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const { enabled, hidden } = value as { enabled?: unknown; hidden?: unknown };
  if (typeof enabled !== "boolean" || !Array.isArray(hidden)) return null;
  return { enabled, hidden: FOLDER_CHIPS.filter((chip) => hidden.includes(chip)) };
}

export function parseFolderChipSettings(raw: string | null | undefined): FolderChipSettings | null {
  if (!raw) return null;
  try {
    return normalizeFolderChipSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeFolderChipSettings(settings: FolderChipSettings | null): string | null {
  return settings ? JSON.stringify(normalizeFolderChipSettings(settings)) : null;
}

// The tags a course page actually shows: the course's own choice if it has
// one, otherwise the global one.
export function visibleFolderChips(
  global: FolderChipSettings | null,
  course: FolderChipSettings | null
): Set<FolderChip> {
  const settings = course ?? global ?? DEFAULT_FOLDER_CHIPS;
  if (!settings.enabled) return new Set();
  return new Set(FOLDER_CHIPS.filter((chip) => !settings.hidden.includes(chip)));
}
