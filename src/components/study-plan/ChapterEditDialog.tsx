"use client";

import { useState } from "react";
import type { Subtopic } from "@/lib/studyPlan/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ChapterDraft {
  title: string;
  summary: string;
  subtopics: Subtopic[];
  stage: number;
}

// Subtopics are edited as one per line; a line whose text is unchanged
// keeps its ticked state.
export function subtopicsFromLines(text: string, previous: Subtopic[]): Subtopic[] {
  const doneByText = new Map(previous.map((s) => [s.text.trim(), s.done]));
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line, done: doneByText.get(line) ?? false }));
}

// Adding a chapter (initial undefined) or editing one.
export function ChapterEditDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ChapterDraft;
  onSave: (draft: ChapterDraft) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState("");
  const [stage, setStage] = useState("");
  const [saving, setSaving] = useState(false);

  // Seeded fresh each time the dialog opens — render-phase sync, same
  // pattern as QuizGenerationDialog.
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setTitle(initial?.title ?? "");
    setSummary(initial?.summary ?? "");
    setLines((initial?.subtopics ?? []).map((s) => s.text).join("\n"));
    setStage(initial ? String(initial.stage) : "");
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const stageNumber = stage.trim() === "" ? null : Number(stage);
  const stageValid = stageNumber === null || (Number.isInteger(stageNumber) && stageNumber >= 1 && stageNumber <= 100);
  const valid = title.trim() !== "" && stageValid;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    const ok = await onSave({
      title: title.trim(),
      summary: summary.trim(),
      subtopics: subtopicsFromLines(lines, initial?.subtopics ?? []),
      stage: stageNumber ?? initial?.stage ?? 0,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit chapter" : "Add chapter"}</DialogTitle>
          <DialogDescription>
            Chapters in the same stage can be studied in parallel.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <div className="grid gap-1.5">
            <Label htmlFor="chapter-title">Title</Label>
            <Input id="chapter-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chapter-summary">Summary</Label>
            <Textarea id="chapter-summary" value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-16" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chapter-subtopics">Checklist</Label>
            <Textarea
              id="chapter-subtopics"
              value={lines}
              onChange={(e) => setLines(e.target.value)}
              placeholder="One subtopic per line"
              className="min-h-32"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chapter-stage">Stage</Label>
            <Input
              id="chapter-stage"
              type="number"
              min={1}
              max={100}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder={initial ? undefined : "After the last stage"}
              className="w-40"
            />
            {!stageValid && <p className="text-xs text-destructive">Use a whole number from 1 to 100.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!valid || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
