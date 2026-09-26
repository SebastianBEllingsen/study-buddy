"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Circle,
  FileText,
  GraduationCap,
  Link2,
  ListVideo,
  LoaderCircle,
  MousePointerClick,
  Pencil,
  PlayCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import type { ResourceKind, StudyPlanChapter, StudyPlanResource, Subtopic } from "@/lib/studyPlan/types";
import { LINK_STATUS_BADGE, RESOURCE_KIND_LABEL, chapterIsComplete } from "@/lib/studyPlanDisplay";
import { languageName } from "@/lib/languages";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChapterEditDialog, type ChapterDraft } from "./ChapterEditDialog";
import { ResourceEditDialog, type ResourceDraft } from "./ResourceEditDialog";
import { ChapterPractice } from "./ChapterPractice";

const KIND_ICON: Record<ResourceKind, LucideIcon> = {
  video: PlayCircle,
  playlist: ListVideo,
  course: GraduationCap,
  article: FileText,
  interactive: MousePointerClick,
  book: BookOpen,
};

const BADGE_TONE = {
  muted: "bg-muted text-muted-foreground",
  warning: "bg-amber/15 text-amber",
  danger: "bg-destructive/10 text-destructive",
} as const;

async function send(url: string, method: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Couldn't save that change");
      return false;
    }
    return true;
  } catch {
    toast.error("Couldn't save that change");
    return false;
  }
}

function ResourceRow({
  resource,
  planId,
  isFirst,
  isLast,
  onMove,
  onChanged,
  onOptimistic,
}: {
  resource: StudyPlanResource;
  planId: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onChanged: () => void;
  onOptimistic: (update: (resource: StudyPlanResource) => StudyPlanResource) => void;
}) {
  const [editing, setEditing] = useState(false);
  const Icon = KIND_ICON[resource.kind] ?? Link2;
  const badge = LINK_STATUS_BADGE[resource.link_status];
  const base = `/api/study-plans/${planId}/resources/${resource.id}`;
  const meta = [
    RESOURCE_KIND_LABEL[resource.kind],
    resource.provider,
    resource.language ? languageName(resource.language) : null,
  ].filter(Boolean);

  async function toggleDone(done: boolean) {
    onOptimistic((r) => ({ ...r, done_at: done ? new Date().toISOString() : null }));
    await send(base, "PATCH", { done });
    onChanged();
  }

  async function handleSave(draft: ResourceDraft): Promise<boolean> {
    const ok = await send(base, "PATCH", draft.title ? draft : { ...draft, title: resource.title });
    if (ok) onChanged();
    return ok;
  }

  return (
    <li className="flex items-start gap-3 py-2">
      <Checkbox
        checked={!!resource.done_at}
        onCheckedChange={(v) => toggleDone(!!v)}
        aria-label={`Mark ${resource.title} as done`}
        className="mt-1"
      />
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "font-medium break-words underline-offset-2 hover:underline",
              resource.done_at && "text-muted-foreground line-through decoration-muted-foreground/50"
            )}
          >
            {resource.title}
          </a>
          {badge && (
            <span
              className={cn("rounded px-1.5 py-0.5 text-[11px] leading-none", BADGE_TONE[badge.tone])}
              title={resource.status_detail ?? undefined}
            >
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
        {resource.note && <p className="text-sm text-muted-foreground">{resource.note}</p>}
      </div>
      <RowActionsMenu
        ariaLabel={`Actions for ${resource.title}`}
        actions={[
          { label: "Edit link", icon: Pencil, onSelect: () => setEditing(true) },
          ...(isFirst ? [] : [{ label: "Move up", icon: ArrowUp, onSelect: () => onMove(-1) }]),
          ...(isLast ? [] : [{ label: "Move down", icon: ArrowDown, onSelect: () => onMove(1) }]),
        ]}
        deleteLabel="Remove link"
        deleteDescription="Removes this link from the chapter."
        onDelete={async () => {
          if (await send(base, "DELETE")) onChanged();
        }}
      />
      <ResourceEditDialog
        open={editing}
        onOpenChange={setEditing}
        initial={{ url: resource.url, title: resource.title, kind: resource.kind, note: resource.note }}
        onSave={handleSave}
      />
    </li>
  );
}

export function ChapterCard({
  chapter,
  number,
  chapterNumbers,
  planId,
  courseId,
  documentNames,
  aiEnabled,
  practice,
  onChanged,
  onOptimistic,
}: {
  chapter: StudyPlanChapter;
  number: number;
  chapterNumbers: Map<number, number>;
  planId: number;
  courseId: number;
  documentNames: Map<number, string>;
  aiEnabled: boolean;
  // Show "Test yourself" (StudyPlanOptions.practice).
  practice: boolean;
  onChanged: () => void;
  // Applies a change to this chapter in the page's cached plan right away,
  // before the server confirms — for checkboxes, which should never lag.
  onOptimistic: (update: (chapter: StudyPlanChapter) => StudyPlanChapter) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [finding, setFinding] = useState(false);
  const base = `/api/study-plans/${planId}/chapters/${chapter.id}`;
  const complete = chapterIsComplete(chapter);
  const prerequisites = chapter.prerequisite_ids
    .map((id) => chapterNumbers.get(id))
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
  const linkedDocs = chapter.linked_document_ids
    .map((id) => ({ id, name: documentNames.get(id) }))
    .filter((d): d is { id: number; name: string } => !!d.name);

  async function saveSubtopics(subtopics: Subtopic[]) {
    onOptimistic((c) => ({ ...c, subtopics }));
    await send(base, "PATCH", { subtopics });
    onChanged();
  }

  async function handleEdit(draft: ChapterDraft): Promise<boolean> {
    const ok = await send(base, "PATCH", {
      title: draft.title,
      summary: draft.summary,
      subtopics: draft.subtopics,
      stage: draft.stage,
    });
    if (ok) onChanged();
    return ok;
  }

  async function handleAddLink(draft: ResourceDraft): Promise<boolean> {
    const ok = await send(`${base}/resources`, "POST", draft);
    if (ok) onChanged();
    return ok;
  }

  async function handleFindResources() {
    setFinding(true);
    try {
      if (await send(`${base}/resources/regenerate`, "POST")) {
        toast.success("Found new resources");
        onChanged();
      }
    } finally {
      setFinding(false);
    }
  }

  async function moveResource(index: number, direction: -1 | 1) {
    const ids = chapter.resources.map((r) => r.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    if (await send(`${base}/resources/reorder`, "POST", { orderedIds: ids })) onChanged();
  }

  return (
    <Card id={`chapter-${chapter.id}`} elevation="flat" className="scroll-mt-20 py-0">
      <CardContent className="space-y-4 py-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              complete ? "bg-sage/15 text-sage" : "bg-focus/12 text-focus"
            )}
          >
            {complete ? <CheckCircle2 className="size-4" /> : number}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="font-heading text-lg leading-snug font-semibold break-words">{chapter.title}</h2>
            <p className="text-xs text-muted-foreground">
              Stage {chapter.stage}
              {prerequisites.length > 0 && <> · Builds on {prerequisites.join(", ")}</>}
              {chapter.current_level === "familiar" && <> · You&apos;ve seen this</>}
              {chapter.current_level === "known" && <> · You know this — review only</>}
            </p>
          </div>
          <RowActionsMenu
            ariaLabel={`Actions for ${chapter.title}`}
            actions={[
              { label: "Edit chapter", icon: Pencil, onSelect: () => setEditing(true) },
              { label: "Add link", icon: Link2, onSelect: () => setAddingLink(true) },
              ...(aiEnabled
                ? [{ label: "Find different resources", icon: RefreshCw, onSelect: handleFindResources }]
                : []),
              chapter.completed_at
                ? {
                    label: "Mark as not done",
                    icon: Circle,
                    onSelect: async () => {
                      if (await send(base, "PATCH", { completed: false })) onChanged();
                    },
                  }
                : {
                    label: "Mark chapter done",
                    icon: CheckCircle2,
                    onSelect: async () => {
                      if (await send(base, "PATCH", { completed: true })) onChanged();
                    },
                  },
            ]}
            deleteLabel="Delete chapter"
            deleteDescription="Removes the chapter, its checklist and its links. This can't be undone."
            onDelete={async () => {
              if (await send(base, "DELETE")) onChanged();
            }}
          />
        </div>

        {chapter.summary && <p className="text-sm text-muted-foreground">{chapter.summary}</p>}

        {chapter.subtopics.length > 0 && (
          <ul className="space-y-1.5">
            {chapter.subtopics.map((subtopic, i) => (
              <li key={i}>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={subtopic.done}
                    onCheckedChange={(v) =>
                      saveSubtopics(chapter.subtopics.map((s, j) => (j === i ? { ...s, done: !!v } : s)))
                    }
                    className="mt-0.5"
                  />
                  <span className={cn(subtopic.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                    {subtopic.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Study in order</h3>
            {finding && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
                Finding resources…
              </span>
            )}
          </div>
          {chapter.resources.length > 0 ? (
            <ol className="divide-y divide-border/60">
              {chapter.resources.map((resource, i) => (
                <ResourceRow
                  key={resource.id}
                  resource={resource}
                  planId={planId}
                  isFirst={i === 0}
                  isLast={i === chapter.resources.length - 1}
                  onMove={(direction) => moveResource(i, direction)}
                  onChanged={onChanged}
                  onOptimistic={(update) =>
                    onOptimistic((c) => ({
                      ...c,
                      resources: c.resources.map((r) => (r.id === resource.id ? update(r) : r)),
                    }))
                  }
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              No links yet{aiEnabled ? " — use “Find different resources” or add your own." : " — add your own."}
            </p>
          )}
        </div>

        {practice && <ChapterPractice chapter={chapter} planId={planId} aiEnabled={aiEnabled} onChanged={onChanged} />}

        {linkedDocs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">From your course:</span>
            {linkedDocs.map((doc) => (
              <Badge key={doc.id} variant="secondary" render={<Link href={`/courses/${courseId}?document=${doc.id}`} />}>
                <FileText className="size-3" />
                {doc.name}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>

      <ChapterEditDialog
        open={editing}
        onOpenChange={setEditing}
        initial={{ title: chapter.title, summary: chapter.summary, subtopics: chapter.subtopics, stage: chapter.stage }}
        onSave={handleEdit}
      />
      <ResourceEditDialog open={addingLink} onOpenChange={setAddingLink} onSave={handleAddLink} />
    </Card>
  );
}
