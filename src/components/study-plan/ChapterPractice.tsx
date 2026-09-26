"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Footprints, HelpCircle, Layers, LoaderCircle, MessageCircleQuestion, NotebookPen, PenLine, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { AppSettings } from "@/lib/models";
import type { ChapterItem, StudyPlanChapter } from "@/lib/studyPlan/types";
import type { QuizGenerationSettings } from "@/lib/types";
import { masteryLevel, type MasteryLevel } from "@/lib/studyPlan/mastery";
import { QuizGenerationDialog } from "@/components/QuizGenerationDialog";
import { Button } from "@/components/ui/button";

type Mode = ChapterItem["mode"];

const MODES: { mode: Mode; label: string; icon: LucideIcon; tint: string }[] = [
  { mode: "quiz", label: "Quiz", icon: HelpCircle, tint: "text-amber" },
  { mode: "flashcards", label: "Flashcards", icon: Layers, tint: "text-sage" },
  { mode: "notes", label: "Notes", icon: NotebookPen, tint: "text-focus" },
];

const MASTERY_COPY: Record<MasteryLevel, string> = {
  none: "Not tested yet",
  weak: "Needs work",
  fair: "Getting there",
  strong: "Strong",
};

const MASTERY_BAR: Record<MasteryLevel, string> = {
  none: "bg-muted-foreground/30",
  weak: "bg-destructive",
  fair: "bg-amber",
  strong: "bg-sage",
};

// "Test yourself" on a study-plan chapter: generate a quiz, flashcards or
// notes for just this chapter, see what's been made for it, and how well
// it's known so far (mastery, from those quizzes and flashcards).
export function ChapterPractice({
  chapter,
  planId,
  aiEnabled,
  onChanged,
}: {
  chapter: StudyPlanChapter;
  planId: number;
  aiEnabled: boolean;
  onChanged: () => void;
}) {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const [generating, setGenerating] = useState<Mode | null>(null);
  const [quizDialogOpen, setQuizDialogOpen] = useState(false);
  const level = masteryLevel(chapter.mastery);

  async function generate(mode: Mode, quizSettings?: QuizGenerationSettings) {
    setGenerating(mode);
    try {
      const res = await fetch(`/api/study-plans/${planId}/chapters/${chapter.id}/generate/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quizSettings ? { quizSettings } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Generation failed");
        return;
      }
      onChanged();
      if (settings?.autoOpenGeneratedItems ?? true) {
        router.push(`/items/${data.id}`);
      } else {
        toast.success(`${MODES.find((m) => m.mode === mode)?.label} ready`);
      }
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Test yourself</h3>
          <div
            className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={chapter.mastery === null ? 0 : Math.round(chapter.mastery * 100)}
            aria-label="Chapter mastery"
          >
            <div
              className={cn("h-full rounded-full", MASTERY_BAR[level])}
              style={{ width: `${chapter.mastery === null ? 0 : Math.round(chapter.mastery * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {MASTERY_COPY[level]}
            {chapter.mastery !== null && ` · ${Math.round(chapter.mastery * 100)}%`}
          </span>
        </div>
        {aiEnabled && (
          <div className="flex flex-wrap gap-1.5">
            {MODES.map(({ mode, label, icon: Icon, tint }) => (
              <Explain key={mode} id={`chapter.${mode}`}>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 bg-card px-2 text-xs"
                disabled={generating !== null}
                aria-busy={generating === mode}
                onClick={() => (mode === "quiz" ? setQuizDialogOpen(true) : generate(mode))}
              >
                {generating === mode ? (
                  <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Icon className={cn("size-3.5", tint)} />
                )}
                {label}
              </Button>
              </Explain>
            ))}
            <Explain id="chapter.problems">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 bg-card px-2 text-xs"
                nativeButton={false}
                render={<Link href={`/courses/${courseId}/problems?chapterId=${chapter.id}`} />}
              >
                <Footprints className="size-3.5 text-focus" />
                Problems
              </Button>
            </Explain>
            {(["blurt", "feynman"] as const).map((kind) => (
              <Explain key={kind} id={kind === "blurt" ? "chapter.blurt" : "chapter.explain"}>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 bg-card px-2 text-xs"
                nativeButton={false}
                render={<Link href={`/courses/${courseId}/explain?kind=${kind}&chapterId=${chapter.id}`} />}
              >
                {kind === "blurt" ? <PenLine className="size-3.5 text-focus" /> : <MessageCircleQuestion className="size-3.5 text-focus" />}
                {kind === "blurt" ? "Blurt" : "Explain it"}
              </Button>
              </Explain>
            ))}
          </div>
        )}
      </div>
      {chapter.items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chapter.items.map((item) => {
            const meta = MODES.find((m) => m.mode === item.mode);
            const Icon = meta?.icon ?? NotebookPen;
            return (
              <li key={item.id}>
                <Link
                  href={`/items/${item.id}`}
                  className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
                >
                  <Icon className={cn("size-3.5", meta?.tint)} />
                  {meta?.label ?? item.mode}
                  {item.best_score !== null && (
                    <span className="text-muted-foreground">· best {Math.round(item.best_score)}%</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {aiEnabled && chapter.items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {chapter.linked_document_ids.length > 0
            ? "Made from this chapter's course documents."
            : "No course documents are linked to this chapter, so it's made from the chapter's topics."}
        </p>
      )}
      {aiEnabled && (
        <QuizGenerationDialog
          open={quizDialogOpen}
          onOpenChange={setQuizDialogOpen}
          onGenerate={(quizSettings) => generate("quiz", quizSettings)}
        />
      )}
    </div>
  );
}
