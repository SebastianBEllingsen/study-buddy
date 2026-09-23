"use client";

import { FileText, Folder as FolderIcon, Sparkles, StickyNote, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { FOLDER_CHIPS, FOLDER_CHIP_LABELS, type FolderChip, type FolderChipSettings } from "@/lib/folderChips";

// Same icons and colors as the tags themselves on the course page, so each
// toggle visibly is the tag it controls.
const CHIP_ICONS: Record<FolderChip, { icon: LucideIcon; className: string }> = {
  documents: { icon: FileText, className: "text-muted-foreground" },
  generated: { icon: Sparkles, className: "text-focus" },
  notes: { icon: StickyNote, className: "text-sage" },
  subfolders: { icon: FolderIcon, className: "text-muted-foreground" },
};

// The on/off switch for folder count tags plus one toggle per tag — used
// for the global setting (Settings → Display) and a course's own override
// (Customize course).
export function FolderChipsPicker({
  value,
  onChange,
  disabled,
}: {
  value: FolderChipSettings;
  onChange: (next: FolderChipSettings) => void;
  disabled?: boolean;
}) {
  function toggleChip(chip: FolderChip) {
    const hidden = value.hidden.includes(chip) ? value.hidden.filter((c) => c !== chip) : [...value.hidden, chip];
    onChange({ ...value, hidden });
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3 text-sm">
        Show folder tags
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
      </label>
      {value.enabled && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which folder tags to show">
          {FOLDER_CHIPS.map((chip) => {
            const on = !value.hidden.includes(chip);
            const { icon: Icon, className } = CHIP_ICONS[chip];
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggleChip(chip)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                  on ? "border-foreground/25 bg-muted text-foreground" : "border-dashed text-muted-foreground line-through"
                )}
              >
                <Icon className={cn("size-3", on ? className : "")} />
                {FOLDER_CHIP_LABELS[chip]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
