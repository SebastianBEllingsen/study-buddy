"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  autoCourseColor,
  PALETTE,
  PALETTE_KEYS,
  type CourseSettings,
  type FeedCalendarConfig,
  type PaletteKey,
} from "@/lib/feedCalendar";

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

function HourSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue>{(v) => hourLabel(Number(v))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((h) => (
          <SelectItem key={h} value={String(h)}>
            {hourLabel(h)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Per-tab settings for a feed's own calendar, stored on the feed row as
// calendar_config (see parseFeedCalendarConfig). Course rows come from the
// course codes the tab has seen in its loaded events plus any already
// customized, so a course with no events this week keeps its settings.
export function FeedCalendarSettings({
  open,
  onOpenChange,
  feedId,
  feedLabel,
  config,
  courseCodes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedId: number;
  feedLabel: string;
  config: FeedCalendarConfig;
  courseCodes: string[];
}) {
  const { mutate } = useSWRConfig();
  const [draft, setDraft] = useState<FeedCalendarConfig>(config);
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seeds from the saved config each time the dialog opens, adjusted
  // during render — same pattern as calendar/page.tsx's EventDialog.
  if (open && !seeded) {
    setDraft(config);
    setSeeded(true);
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const codes = [...new Set([...courseCodes, ...Object.keys(draft.courses)])].sort();

  function updateCourse(code: string, patch: Partial<CourseSettings>) {
    setDraft((prev) => {
      const next: CourseSettings = { ...prev.courses[code], ...patch };
      if (!next.color) delete next.color;
      if (!next.alias) delete next.alias;
      const courses = { ...prev.courses };
      if (next.color || next.alias) courses[code] = next;
      else delete courses[code];
      return { ...prev, courses };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/calendar-feeds/${feedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendar_config: draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't save calendar settings");
        return;
      }
      await mutate("/api/calendar-feeds");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't save calendar settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{feedLabel} calendar</DialogTitle>
          <DialogDescription>How this feed&apos;s own tab looks. Only affects this tab.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="feed-cal-start">Day starts</Label>
              <HourSelect
                id="feed-cal-start"
                value={draft.hourStart}
                options={Array.from({ length: draft.hourEnd }, (_, i) => i)}
                onChange={(hourStart) => setDraft({ ...draft, hourStart })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="feed-cal-end">Day ends</Label>
              <HourSelect
                id="feed-cal-end"
                value={draft.hourEnd}
                options={Array.from({ length: 24 - draft.hourStart }, (_, i) => draft.hourStart + 1 + i)}
                onChange={(hourEnd) => setDraft({ ...draft, hourEnd })}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Events outside these hours are still shown — scroll to reach them.</p>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.showWeekends}
                onCheckedChange={(checked) => setDraft({ ...draft, showWeekends: checked === true })}
              />
              Show weekends
            </label>
            <div className="flex items-center gap-2 text-sm">
              Opens in
              <Select
                value={draft.defaultView}
                onValueChange={(v) => setDraft({ ...draft, defaultView: v === "month" ? "month" : "week" })}
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue>{(v) => (v === "month" ? "Month" : "Week")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Courses</Label>
            {codes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No course codes found in the loaded events yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {codes.map((code) => {
                  const settings = draft.courses[code] ?? {};
                  const effective: PaletteKey = settings.color ?? autoCourseColor(code);
                  return (
                    <li key={code} className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 font-mono text-xs">{code}</span>
                        <Input
                          value={settings.alias ?? ""}
                          maxLength={40}
                          placeholder={code}
                          aria-label={`Display name for ${code}`}
                          className="h-7 text-sm"
                          onChange={(e) => updateCourse(code, { alias: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pl-[4.5rem]">
                        {PALETTE_KEYS.map((key) => (
                          <button
                            key={key}
                            type="button"
                            aria-label={key}
                            aria-pressed={key === effective}
                            onClick={() => updateCourse(code, { color: key })}
                            className={cn(
                              "flex size-5 items-center justify-center rounded border",
                              key === effective && "ring-2 ring-focus ring-offset-1 ring-offset-background"
                            )}
                            style={{ backgroundColor: PALETTE[key].bg, borderColor: PALETTE[key].border }}
                          >
                            {key === effective && <Check className="size-3 text-[#1f2328]" />}
                          </button>
                        ))}
                        {settings.color && (
                          <button
                            type="button"
                            className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => updateCourse(code, { color: undefined })}
                          >
                            Reset to auto
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogCancel />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
