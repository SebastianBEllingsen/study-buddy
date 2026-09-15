"use client";

import { Button } from "@/components/ui/button";
import { ICON_CHOICES, COLOR_CHOICES } from "@/lib/pickerChoices";
import type { Folder } from "@/lib/models";

// Icon + accent-color pickers for a folder — lighter-weight than
// CustomizeCourseDialog (no images/cover banners, just an emoji+color pair),
// so it lives inline as content inside that folder row's RowActionsMenu
// panel rather than a dialog of its own.
export function FolderCustomizeFields({
  folder,
  onCustomize,
}: {
  folder: Folder;
  onCustomize: (folderId: number, fields: { icon?: string | null; color?: string | null }) => void;
}) {
  return (
    <div className="space-y-3 p-1.5">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Icon</p>
          {folder.icon && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-xs"
              onClick={() => onCustomize(folder.id, { icon: null })}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="grid grid-cols-8 gap-1">
          {ICON_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => onCustomize(folder.id, { icon: folder.icon === choice ? null : choice })}
              className={`flex size-6 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted ${
                folder.icon === choice ? "bg-muted ring-1 ring-primary" : ""
              }`}
              aria-label={`Use ${choice} as icon`}
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Color</p>
        <div className="flex items-center gap-2">
          {COLOR_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() =>
                onCustomize(folder.id, { color: folder.color === choice.value ? null : choice.value })
              }
              className={`size-6 rounded-full ring-offset-2 ring-offset-popover transition-shadow ${
                folder.color === choice.value ? "ring-2 ring-primary" : ""
              }`}
              style={{ backgroundColor: choice.value }}
              aria-label={`Use ${choice.label} as color`}
            />
          ))}
          {folder.color && (
            <Button variant="ghost" size="sm" onClick={() => onCustomize(folder.id, { color: null })}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
