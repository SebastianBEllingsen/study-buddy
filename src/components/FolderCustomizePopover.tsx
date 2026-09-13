"use client";

import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ICON_CHOICES, COLOR_CHOICES } from "@/lib/pickerChoices";
import type { Folder } from "@/lib/models";

// A lighter-weight sibling of CustomizeCourseDialog, scoped to what a
// folder actually needs — no images/cover banners, just the same emoji+
// accent-color pair as a course, in a Popover instead of a full Dialog
// since there's far less to pick here.
export function FolderCustomizePopover({
  folder,
  onCustomize,
}: {
  folder: Folder;
  onCustomize: (folderId: number, fields: { icon?: string | null; color?: string | null }) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Customize ${folder.name}`}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        }
      >
        {/* Always the same plain "customize" affordance, regardless of what
            icon/color the folder has — it's a button to open the picker,
            not a preview of the result, which already renders in the
            header next to the folder name. */}
        <Palette className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3" onClick={(e) => e.stopPropagation()}>
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
      </PopoverContent>
    </Popover>
  );
}
