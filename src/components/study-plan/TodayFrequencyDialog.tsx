"use client";

import { useState } from "react";
import { MAX_PER_WEEK, MIN_PER_WEEK, DEFAULT_PER_WEEK, perWeekOf, type TodayCadence } from "@/lib/today/cadence";
import type { StudyPlanOptions } from "@/lib/studyPlan/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type TodayFrequency = Pick<StudyPlanOptions, "todayCadence" | "todayPerWeek">;

const CHOICES: { value: TodayCadence; label: string; hint: string }[] = [
  { value: "auto", label: "Automatic", hint: "Your courses take turns, the one you studied longest ago first." },
  { value: "daily", label: "Every day", hint: "A chapter step from this plan every day you haven't worked on it yet, even on a day its schedule has no session." },
  {
    value: "every_other_day",
    label: "Every other day",
    hint: "Rests the day after you study it. Otherwise it takes its turn as usual.",
  },
  {
    value: "weekly",
    label: "At least some days a week",
    hint: "Moves to the front while you're short of your days in the last 7, then goes back to its turn. Coding practice follows the same days.",
  },
  {
    value: "off",
    label: "Off",
    hint: "Paused: no chapter or practice steps in the all-courses Today. Its own Today still works any time.",
  },
];

// How often a study plan shows up in Today. Work on the plan (a resource, a
// subtopic, a chapter quiz, code practice) counts as studying it that day;
// reviewing the course's other cards doesn't. The mixed view of all courses follows this;
// opening Today for the one course always shows it.
export function TodayFrequencyDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TodayFrequency;
  onSave: (frequency: TodayFrequency) => Promise<boolean>;
}) {
  const [cadence, setCadence] = useState<TodayCadence>("auto");
  const [perWeek, setPerWeek] = useState(DEFAULT_PER_WEEK);
  const [saving, setSaving] = useState(false);

  // Start from the plan's current setting each time it opens.
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setCadence(initial.todayCadence ?? "auto");
    setPerWeek(perWeekOf(initial));
  } else if (!open && seeded) {
    setSeeded(false);
  }

  async function save() {
    setSaving(true);
    const ok = await onSave({ todayCadence: cadence, ...(cadence === "weekly" && { todayPerWeek: perWeek }) });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Today frequency</DialogTitle>
          <DialogDescription>
            How often this plan gets a chapter step in your Today session. Reviews and mistakes aren&apos;t affected, and opening Today for just this course always shows it.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={cadence} onValueChange={(v) => setCadence(v as TodayCadence)} aria-label="How often">
          {CHOICES.map((c) => (
            <Label key={c.value} htmlFor={`cadence-${c.value}`} className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 font-normal">
              <RadioGroupItem id={`cadence-${c.value}`} value={c.value} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        {cadence === "weekly" && (
          <div className="flex items-center gap-3">
            <Label htmlFor="cadence-per-week" className="text-sm text-muted-foreground">
              Study days a week
            </Label>
            <Select value={String(perWeek)} onValueChange={(v) => v && setPerWeek(Number(v))}>
              <SelectTrigger id="cadence-per-week" className="w-20">
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_PER_WEEK - MIN_PER_WEEK + 1 }, (_, i) => MIN_PER_WEEK + i).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
