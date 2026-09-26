"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, LoaderCircle, Pencil, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import type { Flashcard, ItemFlag, QuizQuestion } from "@/lib/types";
import type { FlaggableEntry, FlaggableMode } from "@/lib/sources/flags";
import type { FixSuggestion } from "@/lib/prompts/fixItem";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Explain } from "@/components/Explain";
import { MathText } from "@/components/MathText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntryEditor } from "./EntryEditor";
import { SourceLink } from "./SourceLink";

export interface PanelFlag {
  itemId: number;
  itemTitle?: string;
  mode: FlaggableMode;
  index: number;
  entry: FlaggableEntry;
  flag: ItemFlag;
}

async function post(itemId: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/items/${itemId}/flags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) {
    toast.error(data?.error ?? "Something went wrong");
    return null;
  }
  return data as { suggestion?: FixSuggestion };
}

export function EntryPreview({ mode, entry }: { mode: FlaggableMode; entry: FlaggableEntry }) {
  if (mode === "flashcards") {
    const card = entry as Flashcard;
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          <MathText text={card.front} />
        </p>
        <p className="text-muted-foreground">
          <MathText text={card.back} />
        </p>
      </div>
    );
  }
  const q = entry as QuizQuestion;
  const correct = q.type === "mcq" ? [q.correctIndex] : q.type === "multi_select" ? q.correctIndices : [];
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">
        <MathText text={q.question} />
      </p>
      {q.type === "short_answer" ? (
        <p className="text-muted-foreground">
          <MathText text={q.modelAnswer} />
        </p>
      ) : (
        <ul className="space-y-0.5">
          {q.options.map((o, i) => (
            <li key={i} className={correct.includes(i) ? "text-sage" : "text-muted-foreground"}>
              {correct.includes(i) ? "✓ " : "· "}
              <MathText text={o} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlagRow({ item, showTitle, onChanged }: { item: PanelFlag; showTitle: boolean; onChanged: () => void }) {
  const aiEnabled = useAiEnabled();
  const [busy, setBusy] = useState<null | "fix" | "save" | "keep" | "remove">(null);
  const [editing, setEditing] = useState<FlaggableEntry | null>(null);
  const [suggestion, setSuggestion] = useState<FixSuggestion | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function act(action: "keep" | "remove" | "save", entry?: FlaggableEntry) {
    setBusy(action);
    const ok = await post(item.itemId, { index: item.index, action, entry });
    setBusy(null);
    if (!ok) return;
    toast.success(action === "remove" ? "Removed" : action === "keep" ? "Back in your reviews" : "Fixed — it's back in your reviews");
    setEditing(null);
    setSuggestion(null);
    onChanged();
  }

  async function suggest() {
    setBusy("fix");
    const data = await post(item.itemId, { index: item.index, action: "suggest" });
    setBusy(null);
    if (data?.suggestion) setSuggestion(data.suggestion);
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="border-amber/40 text-amber">
          {item.flag.by === "student" ? "You reported it" : "Fact-check"}
        </Badge>
        {showTitle && (
          <Link href={`/items/${item.itemId}`} className="truncate hover:underline">
            {item.itemTitle}
          </Link>
        )}
        {item.entry.source && <SourceLink source={item.entry.source} />}
      </div>
      {editing ? (
        <EntryEditor
          mode={item.mode}
          initial={editing}
          busy={busy !== null}
          onSave={(entry) => void act("save", entry)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <EntryPreview mode={item.mode} entry={item.entry} />
          <p className="flex gap-1.5 rounded-md bg-amber/10 px-2.5 py-1.5 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber" />
            <span>
              <MathText text={item.flag.issue} />
            </span>
          </p>
        </>
      )}

      {suggestion && !editing && (
        <div className="space-y-2 rounded-md border px-3 py-2">
          {suggestion.verdict === "correct" ? (
            <p className="text-sm">
              <span className="font-medium">Looks correct. </span>
              <MathText text={suggestion.note} />
            </p>
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground">Suggested fix</p>
              <EntryPreview mode={item.mode} entry={suggestion.item} />
              {suggestion.note && (
                <p className="text-xs text-muted-foreground">
                  <MathText text={suggestion.note} />
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {suggestion.verdict === "fixed" ? (
              <>
                <Button size="xs" disabled={busy !== null} onClick={() => void act("save", suggestion.item)}>
                  {busy === "save" && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />}
                  Use this fix
                </Button>
                <Button size="xs" variant="outline" onClick={() => setEditing(suggestion.item)}>
                  Adjust it first
                </Button>
              </>
            ) : (
              <Button size="xs" disabled={busy !== null} onClick={() => void act("keep")}>
                Keep it as it is
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => setSuggestion(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {!editing && !suggestion && (
        <div className="flex flex-wrap gap-1">
          <Explain id="flag.fix">
            <Button size="xs" variant="outline" disabled={!aiEnabled || busy !== null} onClick={() => void suggest()}>
              {busy === "fix" ? (
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Fix with AI
            </Button>
          </Explain>
          <Explain id="flag.edit">
            <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => setEditing(item.entry)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          </Explain>
          <Explain id="flag.keep">
            <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => void act("keep")}>
              <Check className="size-3.5" />
              It&apos;s correct
            </Button>
          </Explain>
          <Explain id="flag.remove">
            <Button
              size="xs"
              variant="ghost"
              className={confirmRemove ? "text-destructive" : undefined}
              disabled={busy !== null}
              onClick={() => (confirmRemove ? void act("remove") : setConfirmRemove(true))}
              onBlur={() => setConfirmRemove(false)}
            >
              <Trash2 className="size-3.5" />
              {confirmRemove ? "Click again to remove" : "Remove"}
            </Button>
          </Explain>
        </div>
      )}
    </li>
  );
}

// Cards and questions held out of review (flagged by the fact-check or
// reported by the student), each with its ways out: fix with AI, edit,
// keep, or remove.
export function FlaggedItemsPanel({
  flags,
  showTitles = false,
  onChanged,
}: {
  flags: PanelFlag[];
  showTitles?: boolean;
  onChanged: () => void;
}) {
  if (flags.length === 0) return null;
  return (
    <section className="space-y-1 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert className="size-4 text-amber" />
        {flags.length} held out of review — possibly wrong
      </h2>
      <p className="text-xs text-muted-foreground">
        These won&apos;t come up in your reviews until you fix them, confirm they&apos;re right, or remove them.
      </p>
      <ul className="divide-y divide-border/60">
        {flags.map((f) => (
          <FlagRow key={`${f.itemId}:${f.index}:${f.flag.at}`} item={f} showTitle={showTitles} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}
