"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import { cn } from "cn";
import type { AppSettings, DocumentSummaryRow } from "@/lib/models";
import type { ResourceDensity, StudyPlan, StudyPlanOptions, StudyPlanPreset } from "@/lib/studyPlan/types";
import { MAX_MINUTES_PER_DAY, MIN_MINUTES_PER_DAY, PRESET_DEFAULTS } from "@/lib/studyPlan/options";
import { WEB_SEARCH_CAPABLE_BACKENDS } from "@/lib/aiBackendChoices";
import { languageName } from "@/lib/languages";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WeekdayPicker } from "./WeekdayPicker";

type SyllabusMode = "document" | "paste" | "none";

const DENSITY_LABELS: Record<ResourceDensity, string> = {
  fewer: "Fewer",
  normal: "Normal",
  more: "More",
};

const PRESETS: { value: StudyPlanPreset; title: string; description: string }[] = [
  {
    value: "roadmap",
    title: "Roadmap + resources",
    description: "Chapters to work through in order, each with links to learn from.",
  },
  {
    value: "guided",
    title: "Full guided",
    description: "Adds what-you-know, practice and mastery per chapter, and a study schedule.",
  },
];

function Toggle({
  checked,
  onChange,
  title,
  hint,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
        <span>
          {title}
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </label>
      {checked && children && <div className="space-y-2 pl-6">{children}</div>}
    </div>
  );
}

// Opens from the course page's "Study plan" tile. Asks where the curriculum
// comes from (a course document, pasted text, or nothing — inferred from
// the material), then which parts of a plan to build: a preset picks the
// defaults, and each part can be switched on or off. The material scope
// itself is the course page's existing Material picker, passed in.
export function StudyPlanSetupDialog({
  open,
  onOpenChange,
  courseId,
  documents,
  scope,
  hasExistingPlan,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: number;
  documents: DocumentSummaryRow[];
  scope: { folderId: number | null; documentIds: number[] | null; label: string };
  hasExistingPlan: boolean;
  onCreated: (plan: StudyPlan) => void;
}) {
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const extracted = documents.filter((d) => d.status === "extracted");
  const [mode, setMode] = useState<SyllabusMode>(extracted.length ? "document" : "paste");
  const [syllabusDocId, setSyllabusDocId] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [options, setOptions] = useState<StudyPlanOptions>(PRESET_DEFAULTS.roadmap);
  const [minutesDraft, setMinutesDraft] = useState(String(PRESET_DEFAULTS.roadmap.minutesPerDay));
  const [building, setBuilding] = useState(false);

  const canSearch = settings ? WEB_SEARCH_CAPABLE_BACKENDS.includes(settings.aiBackend) : true;
  const hasSyllabus = (mode === "document" && syllabusDocId !== "") || (mode === "paste" && pasted.trim() !== "");
  const minutes = Number(minutesDraft);
  const minutesValid = Number.isInteger(minutes) && minutes >= MIN_MINUTES_PER_DAY && minutes <= MAX_MINUTES_PER_DAY;
  const scheduleValid = !options.schedule || (options.studyDays.length > 0 && minutesValid);
  const canBuild = !building && scheduleValid && (mode === "none" ? extracted.length > 0 : hasSyllabus);

  function update(patch: Partial<StudyPlanOptions>) {
    setOptions((prev) => ({ ...prev, ...patch }));
  }

  // Switching preset resets the on/off parts to that preset's, but keeps the
  // details already typed in (deadline, days, minutes, link count).
  function choosePreset(preset: StudyPlanPreset) {
    const d = PRESET_DEFAULTS[preset];
    update({
      preset,
      webResources: d.webResources,
      topicLevels: d.topicLevels,
      practice: d.practice,
      schedule: d.schedule,
    });
  }

  async function handleBuild() {
    if (!canBuild) return;
    setBuilding(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/study-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabus:
            mode === "document"
              ? { documentId: Number(syllabusDocId) }
              : mode === "paste"
                ? { text: pasted }
                : null,
          folderId: scope.folderId,
          documentIds: scope.documentIds,
          options: { ...options, minutesPerDay: minutesValid ? minutes : options.minutesPerDay },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't build the study plan");
        return;
      }
      const plan = data.plan as StudyPlan;
      toast.success(plan.status === "draft_topics" ? "Chapters ready — mark what you already know" : "Study plan ready");
      onOpenChange(false);
      onCreated(plan);
    } catch {
      toast.error("Couldn't build the study plan");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{hasExistingPlan ? "Rebuild study plan" : "Build a study plan"}</DialogTitle>
          <DialogDescription>
            A roadmap of chapters to work through in order, each with a checklist and links to learn it from.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
          <div className="space-y-2">
            <Label>Curriculum</Label>
            <ToggleGroup
              value={[mode]}
              onValueChange={(v: string[]) => v[0] && setMode(v[0] as SyllabusMode)}
              size="sm"
              variant="outline"
            >
              <ToggleGroupItem value="document" disabled={extracted.length === 0}>
                Course document
              </ToggleGroupItem>
              <ToggleGroupItem value="paste">Paste text</ToggleGroupItem>
              <ToggleGroupItem value="none" disabled={extracted.length === 0}>
                None
              </ToggleGroupItem>
            </ToggleGroup>
            {mode === "document" && (
              <Select value={syllabusDocId} onValueChange={(v) => setSyllabusDocId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      extracted.find((d) => String(d.id) === v)?.filename ?? "Choose the syllabus document"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {extracted.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {mode === "paste" && (
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={"Paste the syllabus, learning goals, or a list of topics.\n\nExample:\n1. Foundations\n2. Core methods\n3. Applications"}
                className="min-h-36 text-sm"
              />
            )}
            {mode === "none" && (
              <p className="text-xs text-muted-foreground">Topics are worked out from the course material instead.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Course material</Label>
            <p className="text-sm">{scope.label}</p>
            <p className="text-xs text-muted-foreground">
              Chapters are linked to matching documents from here. Change it with the Material picker under Practice.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Plan type</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={options.preset === preset.value}
                  onClick={() => choosePreset(preset.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60",
                    options.preset === preset.value && "border-primary bg-primary/5"
                  )}
                >
                  <span className="block text-sm font-medium">{preset.title}</span>
                  <span className="block text-xs text-muted-foreground">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Include</Label>
            <Toggle
              checked={options.webResources}
              onChange={(webResources) => update({ webResources })}
              title="Learning resources from the web"
              hint={
                canSearch
                  ? "Videos, open courses and articles found by web search. Every link is checked."
                  : "Your AI provider can't search the web, so resources come from what the model already knows. Every link is still checked."
              }
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Per chapter</span>
                <ToggleGroup
                  value={[options.density]}
                  onValueChange={(v: string[]) => v[0] && update({ density: v[0] as ResourceDensity })}
                  size="sm"
                  variant="outline"
                >
                  {(Object.keys(DENSITY_LABELS) as ResourceDensity[]).map((d) => (
                    <ToggleGroupItem key={d} value={d}>
                      {DENSITY_LABELS[d]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </Toggle>
            <Toggle
              checked={options.topicLevels}
              onChange={(topicLevels) => update({ topicLevels })}
              title="Mark what I already know first"
              hint="See the chapters before resources are found, and mark ones you've seen or know — they get lighter material."
            />
            <Toggle
              checked={options.practice}
              onChange={(practice) => update({ practice })}
              title="Practice and mastery per chapter"
              hint="Quiz, flashcard and notes buttons on each chapter; your results show how well you know it."
            />
            <Toggle
              checked={options.schedule}
              onChange={(schedule) => update({ schedule })}
              title="Study schedule"
              hint="Spreads the chapters over study sessions on your calendar, in roadmap order."
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                <Label htmlFor="plan-deadline" className="text-xs text-muted-foreground">
                  Finish by
                </Label>
                <Input
                  id="plan-deadline"
                  type="date"
                  value={options.deadline ?? ""}
                  onChange={(e) => update({ deadline: e.target.value || null })}
                  className="h-8 w-44 text-sm"
                />
                <span className="text-xs text-muted-foreground">Study on</span>
                <WeekdayPicker value={options.studyDays} onChange={(studyDays) => update({ studyDays })} />
                <Label htmlFor="plan-minutes" className="text-xs text-muted-foreground">
                  Minutes a day
                </Label>
                <Input
                  id="plan-minutes"
                  type="number"
                  min={MIN_MINUTES_PER_DAY}
                  max={MAX_MINUTES_PER_DAY}
                  step={15}
                  value={minutesDraft}
                  onChange={(e) => setMinutesDraft(e.target.value)}
                  className="h-8 w-24 text-sm"
                />
              </div>
              {options.studyDays.length === 0 && <p className="text-xs text-destructive">Pick at least one day.</p>}
              {!minutesValid && (
                <p className="text-xs text-destructive">
                  Use {MIN_MINUTES_PER_DAY}–{MAX_MINUTES_PER_DAY} minutes.
                </p>
              )}
              {!options.deadline && (
                <p className="text-xs text-muted-foreground">
                  No date: sessions just continue until everything&apos;s covered.
                </p>
              )}
            </Toggle>
            {settings && (
              <p className="text-xs text-muted-foreground">
                Written in {languageName(settings.preferredLanguage)} — change the language in Settings.
              </p>
            )}
          </div>

          {hasExistingPlan && (
            <p className="rounded-md bg-amber/10 px-3 py-2 text-xs text-amber">
              This replaces the current study plan. Progress carries over for chapters with the same title.
            </p>
          )}
        </div>

        <DialogFooter>
          {building && (
            <p className="mr-auto flex items-center gap-2 self-center text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              {options.topicLevels ? "Working out the chapters…" : "This can take a minute or two."}
            </p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleBuild} disabled={!canBuild}>
            {building
              ? "Building…"
              : options.topicLevels
                ? "Next: what you know"
                : hasExistingPlan
                  ? "Rebuild plan"
                  : "Build plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
