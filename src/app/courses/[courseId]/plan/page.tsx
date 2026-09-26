"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarDays, FilePlus2, GraduationCap, LinkIcon, LoaderCircle, Pencil, Plus, Route } from "lucide-react";
import type { AppSettings, Course, DocumentSummaryRow } from "@/lib/models";
import type { StudyPlan, StudyPlanChapter, StudyPlanOptions } from "@/lib/studyPlan/types";
import { roadmapLabel } from "@/lib/studyPlan/roadmap";
import { buildIsStuck, chapterNumbers, linksAreStale, planProgress } from "@/lib/studyPlanDisplay";
import { useAiEnabled } from "@/lib/useAiEnabled";
import ModelBadge from "@/components/ModelBadge";
import { useShowModelBadge } from "@/lib/useShowModelBadge";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { RoadmapIndex } from "@/components/study-plan/RoadmapIndex";
import { ChapterCard } from "@/components/study-plan/ChapterCard";
import { ChapterEditDialog, type ChapterDraft } from "@/components/study-plan/ChapterEditDialog";
import { TopicLevelStep } from "@/components/study-plan/TopicLevelStep";
import { ScheduleView } from "@/components/study-plan/ScheduleView";
import { ScheduleSettingsDialog } from "@/components/study-plan/ScheduleSettingsDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Shares the course page's SWR key, so edits here and the course page's
// plan card stay in sync without a separate fetch.
interface CourseDetail {
  course: Course;
  documents: DocumentSummaryRow[];
  studyPlan: StudyPlan | null;
}

export default function StudyPlanPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const modelBadge = useShowModelBadge();
  const key = `/api/courses/${courseId}`;
  // Polls while the resource step is running, so chapters fill in as their
  // links are found.
  const { data: detail, error, mutate } = useSWR<CourseDetail>(key, {
    refreshInterval: (latest) => (latest?.studyPlan?.status === "generating" ? 4000 : 0),
  });
  const plan = detail?.studyPlan ?? null;

  const [checkingLinks, setCheckingLinks] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [supplementing, setSupplementing] = useState(false);
  const [scheduleSetupOpen, setScheduleSetupOpen] = useState(false);
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  // Course documents added since the plan was built — offered as "Update
  // plan" (see lib/studyPlan/supplement.ts).
  const { data: newMaterial, mutate: refreshNewMaterial } = useSWR<{ documents: { id: number; filename: string }[] }>(
    plan && plan.status === "ready" && aiEnabled ? `/api/study-plans/${plan.id}/supplement` : null
  );
  const [addingChapter, setAddingChapter] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  async function checkLinks(quiet = false) {
    if (!plan) return;
    setCheckingLinks(true);
    try {
      const res = await fetch(`/api/study-plans/${plan.id}/check-links`, { method: "POST" });
      if (!res.ok) throw new Error();
      await mutate();
      if (!quiet) toast.success("Links checked");
    } catch {
      if (!quiet) toast.error("Couldn't check the links");
    } finally {
      setCheckingLinks(false);
    }
  }

  // Links rot — re-check in the background when the plan is opened and the
  // last check is old. Once per plan per visit.
  const autoCheckedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!plan || plan.status !== "ready" || autoCheckedFor.current === plan.id || !linksAreStale(plan)) return;
    autoCheckedFor.current = plan.id;
    void checkLinks(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, plan?.links_checked_at]);

  function updateChapterLocally(chapterId: number, update: (chapter: StudyPlanChapter) => StudyPlanChapter) {
    void mutate(
      (prev) =>
        prev?.studyPlan
          ? {
              ...prev,
              studyPlan: {
                ...prev.studyPlan,
                chapters: prev.studyPlan.chapters.map((c) => (c.id === chapterId ? update(c) : c)),
              },
            }
          : prev,
      { revalidate: false }
    );
  }

  // Re-runs the resource step after a failed or cut-off build, with the
  // levels already recorded on each chapter.
  async function handleRetryBuild() {
    if (!plan) return;
    setRetrying(true);
    const started = setTimeout(() => void mutate(), 1500);
    try {
      const res = await fetch(`/api/study-plans/${plan.id}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          levels: Object.fromEntries(
            plan.chapters.filter((c) => c.current_level).map((c) => [c.id, c.current_level])
          ),
        }),
      });
      if (!res.ok) toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't build the plan");
    } catch {
      toast.error("Couldn't build the plan");
    } finally {
      clearTimeout(started);
      setRetrying(false);
      await mutate();
    }
  }

  async function handleSupplement() {
    if (!plan) return;
    setSupplementing(true);
    try {
      const res = await fetch(`/api/study-plans/${plan.id}/supplement`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't update the plan");
        return;
      }
      const parts = [
        data.updatedChapters ? `${data.updatedChapters} chapter${data.updatedChapters === 1 ? "" : "s"} extended` : null,
        data.addedChapters ? `${data.addedChapters} new chapter${data.addedChapters === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      toast.success(parts.length ? `Plan updated: ${parts.join(", ")}` : "Nothing new to add — the plan already covers it");
      await Promise.all([mutate(), refreshNewMaterial()]);
    } catch {
      toast.error("Couldn't update the plan");
    } finally {
      setSupplementing(false);
    }
  }

  async function handleAddChapter(draft: ChapterDraft): Promise<boolean> {
    if (!plan) return false;
    const res = await fetch(`/api/study-plans/${plan.id}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        summary: draft.summary,
        subtopics: draft.subtopics.map((s) => s.text),
        ...(draft.stage > 0 ? { stage: draft.stage } : {}),
      }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't add the chapter");
      return false;
    }
    await mutate();
    return true;
  }

  async function updateOptions(options: Partial<StudyPlanOptions>) {
    if (!plan) return;
    const res = await fetch(`/api/study-plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options }),
    });
    if (!res.ok) toast.error("Couldn't update the plan");
    await mutate();
  }

  async function handleRename() {
    const title = titleDraft.trim();
    if (!plan || !title || title === plan.title) {
      setRenaming(false);
      return;
    }
    const res = await fetch(`/api/study-plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) toast.error("Couldn't rename the plan");
    setRenaming(false);
    await mutate();
  }

  async function handleDelete() {
    if (!plan) return;
    const res = await fetch(`/api/study-plans/${plan.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete the plan");
      return;
    }
    await mutate();
    router.push(`/courses/${courseId}`);
  }

  if (error || (detail && !plan)) {
    return (
      <div className="space-y-3">
        <h1 className="font-heading text-2xl font-semibold">No study plan yet</h1>
        <p className="text-sm text-muted-foreground">
          Build one from the course page — open Practice and choose Study plan.
        </p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/courses/${courseId}`} />}>
          Back to the course
        </Button>
      </div>
    );
  }

  if (!detail || !plan) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const numbers = chapterNumbers(plan.chapters);
  const progress = planProgress(plan);
  const percent = Math.round(progress.fraction * 100);
  const documentNames = new Map(detail.documents.map((d) => [d.id, d.filename]));
  const sortedChapters = [...plan.chapters].sort((a, b) => a.position - b.position);
  const stuck = buildIsStuck(plan);
  const showRetry = plan.status === "failed" || stuck;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Study Buddy</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/courses/${courseId}`} />}>{detail.course.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Study plan</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {renaming ? (
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="h-9 max-w-md font-heading text-xl font-semibold"
            />
          ) : (
            <h1 className="flex min-w-0 flex-wrap items-center gap-2 font-heading text-2xl font-semibold break-words">
              <Route className="size-5 shrink-0 text-focus" />
              {plan.title}
              {modelBadge.show && plan.model_provider && (
                <ModelBadge
                  info={{ model_provider: plan.model_provider, model_name: plan.model_name }}
                  detail={modelBadge.detail}
                />
              )}
            </h1>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => checkLinks()} disabled={checkingLinks}>
              {checkingLinks ? (
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <LinkIcon className="size-3.5" />
              )}
              {checkingLinks ? "Checking links…" : "Check links"}
            </Button>
            <RowActionsMenu
              ariaLabel="Study plan actions"
              actions={[
                {
                  label: "Rename",
                  icon: Pencil,
                  onSelect: () => {
                    setTitleDraft(plan.title);
                    setRenaming(true);
                  },
                },
                { label: "Add chapter", icon: Plus, onSelect: () => setAddingChapter(true) },
                ...(plan.options.schedule
                  ? []
                  : [{ label: "Add a schedule", icon: CalendarDays, onSelect: () => setScheduleSetupOpen(true) }]),
                {
                  label: plan.options.practice ? "Hide “Test yourself”" : "Show “Test yourself”",
                  icon: GraduationCap,
                  onSelect: () => void updateOptions({ practice: !plan.options.practice }),
                },
              ]}
              deleteLabel="Delete study plan"
              deleteDescription="Deletes the plan, its checklists and its links. Course documents aren't touched."
              onDelete={handleDelete}
            />
          </div>
        </div>
      </div>

      {showRetry && (
        <Alert variant="destructive">
          <AlertTitle>{stuck ? "Building this plan was interrupted" : "Building this plan didn't finish"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{plan.error_message ?? "Some chapters may be missing their links."}</span>
            <Button size="sm" variant="outline" onClick={handleRetryBuild} disabled={retrying}>
              {retrying ? "Retrying…" : "Try again"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {plan.status === "generating" && !stuck && (
        <Alert>
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          <AlertTitle>Finding resources</AlertTitle>
          <AlertDescription>Chapters fill in as their links are found and checked.</AlertDescription>
        </Alert>
      )}

      {newMaterial && newMaterial.documents.length > 0 && (
        <Alert>
          <FilePlus2 />
          <AlertTitle>
            {newMaterial.documents.length} new document{newMaterial.documents.length === 1 ? "" : "s"} since this plan was
            built
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 truncate">
              {newMaterial.documents
                .slice(0, 3)
                .map((d) => d.filename)
                .join(", ")}
              {newMaterial.documents.length > 3 && `, and ${newMaterial.documents.length - 3} more`} — add what they
              cover without starting over.
            </span>
            <Button size="sm" onClick={handleSupplement} disabled={supplementing}>
              {supplementing ? "Updating…" : "Update plan"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {plan.status === "draft_topics" ? (
        <TopicLevelStep plan={plan} onStarted={() => void mutate()} onFinished={() => void mutate()} />
      ) : (
      <>
      <div className="space-y-3">
        {plan.chapters.length > 1 && (
          <p className="text-sm text-muted-foreground" title="Chapters joined by + can be studied in parallel">
            {roadmapLabel(plan.chapters)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div
            className="h-2 w-56 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Study plan progress"
          >
            <div className="h-full rounded-full bg-focus transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-sm text-muted-foreground">
            {percent}% · {progress.chaptersDone} of {progress.chaptersTotal} chapters done
          </span>
        </div>
        {plan.chapters.some((c) => c.resources.length > 0) && (
          <p className="text-xs text-muted-foreground">
            {plan.used_web_search
              ? "Resources were found by web search."
              : "Resources were suggested from the AI model's own knowledge."}{" "}
            Every link is checked automatically; badges mark any that need a look.
          </p>
        )}
      </div>

      {plan.chapters.length > 1 && <RoadmapIndex chapters={plan.chapters} chapterNumbers={numbers} />}

      {plan.options.schedule && plan.status === "ready" && (
        <ScheduleView
          plan={plan}
          chapterNumbers={numbers}
          googleConnected={!!settings?.googleCalendarConnected}
          onChanged={() => void mutate()}
        />
      )}

      <div className="space-y-4">
        {sortedChapters.map((chapter) => (
          <ChapterCard
            key={chapter.id}
            chapter={chapter}
            number={numbers.get(chapter.id) ?? 0}
            chapterNumbers={numbers}
            planId={plan.id}
            courseId={Number(courseId)}
            documentNames={documentNames}
            aiEnabled={aiEnabled}
            practice={plan.options.practice}
            onChanged={() => void mutate()}
            onOptimistic={(update) => updateChapterLocally(chapter.id, update)}
          />
        ))}
        {sortedChapters.length === 0 && (
          <p className="text-sm text-muted-foreground">This plan has no chapters — add one from the ⋯ menu.</p>
        )}
      </div>
      </>
      )}

      <ChapterEditDialog open={addingChapter} onOpenChange={setAddingChapter} onSave={handleAddChapter} />
      <ScheduleSettingsDialog
        open={scheduleSetupOpen}
        onOpenChange={setScheduleSetupOpen}
        initial={{
          deadline: plan.options.deadline,
          studyDays: plan.options.studyDays,
          minutesPerDay: plan.options.minutesPerDay,
        }}
        onSave={async (schedule) => {
          await updateOptions({ schedule: true, ...schedule });
          return true;
        }}
      />
    </div>
  );
}
