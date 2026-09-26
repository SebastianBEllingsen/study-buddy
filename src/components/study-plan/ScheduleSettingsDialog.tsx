"use client";

import { useState } from "react";
import type { StudyPlanOptions } from "@/lib/studyPlan/types";
import { MAX_MINUTES_PER_DAY, MIN_MINUTES_PER_DAY } from "@/lib/studyPlan/options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WeekdayPicker } from "./WeekdayPicker";

export type ScheduleSettings = Pick<StudyPlanOptions, "deadline" | "studyDays" | "minutesPerDay">;

// Sets up (or changes) a plan's schedule: finish date, weekdays, minutes a
// day. Saving rebuilds the open sessions from today. `onTurnOff` is only
// offered on a plan that already has a schedule.
export function ScheduleSettingsDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  onTurnOff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ScheduleSettings;
  onSave: (settings: ScheduleSettings) => Promise<boolean>;
  onTurnOff?: () => Promise<boolean>;
}) {
  const [deadline, setDeadline] = useState("");
  const [studyDays, setStudyDays] = useState<number[]>([]);
  const [minutes, setMinutes] = useState("");
  const [saving, setSaving] = useState(false);

  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setDeadline(initial.deadline ?? "");
    setStudyDays(initial.studyDays);
    setMinutes(String(initial.minutesPerDay));
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const minutesNumber = Number(minutes);
  const minutesValid =
    Number.isInteger(minutesNumber) && minutesNumber >= MIN_MINUTES_PER_DAY && minutesNumber <= MAX_MINUTES_PER_DAY;
  const valid = minutesValid && studyDays.length > 0;

  async function run(action: () => Promise<boolean>) {
    setSaving(true);
    const ok = await action();
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Study schedule</DialogTitle>
          <DialogDescription>
            Chapters are spread over these days in roadmap order. Saving rebuilds the schedule from today; finished
            sessions are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
          <Label htmlFor="schedule-deadline" className="text-sm text-muted-foreground">
            Finish by
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="schedule-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-8 w-44"
            />
            {deadline && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setDeadline("")}>
                No date
              </Button>
            )}
          </div>
          <span className="text-sm text-muted-foreground">Study on</span>
          <WeekdayPicker value={studyDays} onChange={setStudyDays} />
          <Label htmlFor="schedule-minutes" className="text-sm text-muted-foreground">
            Minutes a day
          </Label>
          <Input
            id="schedule-minutes"
            type="number"
            min={MIN_MINUTES_PER_DAY}
            max={MAX_MINUTES_PER_DAY}
            step={15}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-8 w-24"
          />
        </div>
        {studyDays.length === 0 && <p className="text-xs text-destructive">Pick at least one day.</p>}
        {!minutesValid && (
          <p className="text-xs text-destructive">
            Use {MIN_MINUTES_PER_DAY}–{MAX_MINUTES_PER_DAY} minutes.
          </p>
        )}
        <DialogFooter>
          {onTurnOff && (
            <Button variant="ghost" className="mr-auto" disabled={saving} onClick={() => run(onTurnOff)}>
              Turn off schedule
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={() => run(() => onSave({ deadline: deadline || null, studyDays, minutesPerDay: minutesNumber }))}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
