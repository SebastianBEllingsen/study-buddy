"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { DEFAULT_QUIZ_SETTINGS, type QuizGenerationSettings } from "@/lib/types";
import type { QuizPreset } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const TYPE_OPTIONS: { key: keyof QuizGenerationSettings; label: string; hint: string }[] = [
  { key: "singleChoice", label: "Single choice", hint: "Pick one correct answer." },
  {
    key: "multipleChoice",
    label: "Multiple choice",
    hint: "Select all that apply — two or more correct answers.",
  },
  { key: "shortAnswer", label: "Short answer", hint: "Free-text response, graded against a model answer." },
];

// Opens before a quiz actually generates — see the course page's "Generate
// Quiz" button — so the user picks which question types to include (and
// optionally saves that mix as a named preset for next time) rather than
// getting whatever the model defaults to.
export function QuizGenerationDialog({
  open,
  onOpenChange,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (settings: QuizGenerationSettings) => void;
}) {
  const [settings, setSettings] = useState<QuizGenerationSettings>(DEFAULT_QUIZ_SETTINGS);
  const [presets, setPresets] = useState<QuizPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  // Reloads presets, and resets the draft settings, fresh every time the
  // dialog opens — render-phase sync (see DocumentPickerDialog's own seeded
  // flag elsewhere in this app) rather than a useEffect.
  const [loadedForOpen, setLoadedForOpen] = useState(false);
  if (open && !loadedForOpen) {
    setLoadedForOpen(true);
    fetch("/api/quiz-presets")
      .then((r) => r.json())
      .then(setPresets);
  } else if (!open && loadedForOpen) {
    setLoadedForOpen(false);
    setSettings(DEFAULT_QUIZ_SETTINGS);
    setPresetName("");
  }

  function toggleType(key: keyof QuizGenerationSettings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const isValid = settings.singleChoice || settings.multipleChoice || settings.shortAnswer;

  async function handleSavePreset() {
    const name = presetName.trim();
    if (!name || !isValid) return;
    setSavingPreset(true);
    try {
      const res = await fetch("/api/quiz-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, settings }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save preset");
        return;
      }
      setPresets((prev) => [...prev, body as QuizPreset]);
      setPresetName("");
    } catch {
      toast.error("Couldn't save preset");
    } finally {
      setSavingPreset(false);
    }
  }

  function handleDeletePreset(id: number) {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    fetch(`/api/quiz-presets/${id}`, { method: "DELETE" }).catch(() => {});
  }

  function handleGenerateClick() {
    if (!isValid) return;
    onGenerate(settings);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quiz settings</DialogTitle>
          <DialogDescription>Choose which kinds of questions to generate.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {presets.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Presets</Label>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <Badge key={preset.id} variant="secondary" className="gap-1 py-1 pr-1">
                    <button type="button" className="hover:underline" onClick={() => setSettings(preset.settings)}>
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete preset ${preset.name}`}
                      className="rounded-sm p-0.5 hover:bg-foreground/10"
                      onClick={() => handleDeletePreset(preset.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            {TYPE_OPTIONS.map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <Checkbox checked={settings[key]} onCheckedChange={() => toggleType(key)} className="mt-0.5" />
                <span>
                  {label}
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {!isValid && <p className="text-xs text-destructive">Pick at least one question type.</p>}

          <div className="flex items-center gap-2 border-t pt-3">
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Save current mix as…"
              className="h-8 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!presetName.trim() || !isValid || savingPreset}
              onClick={handleSavePreset}
            >
              <Plus className="size-3.5" />
              Save
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerateClick} disabled={!isValid}>
            Generate quiz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
