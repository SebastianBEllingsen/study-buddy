"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { FileText, GitCompareArrows, LoaderCircle, NotebookPen, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import type { SourceTrust } from "@/lib/sources/types";
import type { CourseFlag } from "@/lib/sources/flagStore";
import type { StoredConflictCheck } from "@/lib/sources/conflicts";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Explain } from "@/components/Explain";
import { MathText } from "@/components/MathText";
import { FlaggedItemsPanel } from "@/components/sources/FlaggedItemsPanel";
import { SourceLink } from "@/components/sources/SourceLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface SourcesResponse {
  course: { id: number; name: string };
  documents: { id: number; filename: string; trust: SourceTrust; status: string }[];
  notes: { id: number; title: string; icon: string | null; generationSource: SourceTrust | null }[];
  flags: CourseFlag[];
  check: (StoredConflictCheck & { newSources: number }) | null;
  comparableSources: number;
}

const NOTE_OPTIONS: Record<"off" | SourceTrust, string> = {
  off: "Not used",
  official: "Official",
  personal: "Personal",
};

function TrustToggle({ value, onChange }: { value: SourceTrust; onChange: (value: SourceTrust) => void }) {
  return (
    <Explain id="sources.trust">
      <div role="radiogroup" aria-label="Trust" className="flex shrink-0 rounded-md border p-0.5 text-xs">
        {(["official", "personal"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={value === t}
            onClick={() => value !== t && onChange(t)}
            className={cn(
              "rounded px-2 py-0.5 transition-colors",
              value === t ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "official" ? "Official" : "Personal"}
          </button>
        ))}
      </div>
    </Explain>
  );
}

export default function SourcesPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const key = `/api/courses/${courseId}/sources`;
  const { data, error, mutate } = useSWR<SourcesResponse>(key);
  const aiEnabled = useAiEnabled();
  const [checking, setChecking] = useState(false);

  async function patch(url: string, body: Record<string, unknown>, optimistic: SourcesResponse) {
    void mutate(optimistic, { revalidate: false });
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't save that");
    void mutate();
  }

  async function runCheck() {
    setChecking(true);
    const res = await fetch(`${key}/check`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setChecking(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't compare the sources");
      return;
    }
    void mutate();
  }

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load this course&apos;s sources.</p>;
  if (!data) return <Skeleton className="h-64 rounded-xl" />;

  const extracted = data.documents.filter((d) => d.status === "extracted");
  const check = data.check;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline">
          ← {data.course.name}
        </Link>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <ShieldCheck className="size-6 text-focus" />
          Sources and accuracy
        </h1>
        <p className="text-sm text-muted-foreground">
          What new flashcards, quizzes and notes are made from, and how far each source is trusted. Official material
          (a course&apos;s own material, a textbook, official documentation) wins where sources disagree; personal notes only back it up. New cards and
          questions are fact-checked, and anything doubtful is held out of your reviews until you look at it.
        </p>
      </div>

      <FlaggedItemsPanel
        flags={data.flags}
        showTitles
        onChanged={() => void mutate()}
      />

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Documents</h2>
        {extracted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents with readable text yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {extracted.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={`/documents/${d.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {d.filename}
                </a>
                <TrustToggle
                  value={d.trust}
                  onChange={(trust) =>
                    void patch(`/api/courses/${courseId}/documents/${d.id}`, { trust }, {
                      ...data,
                      documents: data.documents.map((x) => (x.id === d.id ? { ...x, trust } : x)),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Notes</h2>
        <p className="text-xs text-muted-foreground">
          Notes are left out of generation unless you choose otherwise. Mark notes copied from course material as
          official, and your own notes as personal.
        </p>
        {data.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">This course has no notes.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.notes.map((n) => (
              <li key={n.id} className="flex items-center gap-2 py-2">
                {n.icon ? <span className="w-4 text-center text-sm">{n.icon}</span> : <NotebookPen className="size-4 shrink-0 text-muted-foreground" />}
                <Link href={`/vault/${n.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {n.title}
                </Link>
                <Explain id="note.generation">
                  <div>
                    <Select
                      value={n.generationSource ?? "off"}
                      onValueChange={(v) => {
                        const generationSource = !v || v === "off" ? null : (v as SourceTrust);
                        void patch(`/api/notes/${n.id}`, { generationSource }, {
                          ...data,
                          notes: data.notes.map((x) => (x.id === n.id ? { ...x, generationSource } : x)),
                        });
                      }}
                    >
                      <SelectTrigger size="sm" className="w-32 text-xs" aria-label={`Use ${n.title} in generation`}>
                        <SelectValue>{(v: "off" | SourceTrust) => NOTE_OPTIONS[v] ?? NOTE_OPTIONS.off}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="off">Not used</SelectItem>
                        <SelectItem value="official">Official</SelectItem>
                        <SelectItem value="personal">Personal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </Explain>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-medium">
                <GitCompareArrows className="size-4 text-focus" />
                Where do your sources disagree?
              </h2>
              <p className="text-sm text-muted-foreground">
                {check
                  ? `Last compared ${check.createdAt.slice(0, 10)} · ${check.sourceCount} sources${
                      check.newSources > 0 ? ` · ${check.newSources} new since` : ""
                    }`
                  : "Compares your documents and notes used for generation, and lists contradictions."}
              </p>
            </div>
            <Explain id="sources.check">
              <Button
                variant={check && check.newSources === 0 ? "outline" : "default"}
                disabled={!aiEnabled || checking || data.comparableSources < 2}
                onClick={() => void runCheck()}
              >
                {checking && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
                {checking ? "Comparing…" : check ? "Compare again" : "Compare sources"}
              </Button>
            </Explain>
          </div>
          {data.comparableSources < 2 && (
            <p className="text-xs text-muted-foreground">Needs at least two documents or notes used for generation.</p>
          )}
          {!aiEnabled && <p className="text-xs text-muted-foreground">This needs AI — turn it on in Settings.</p>}
          {check && check.partial && (
            <p className="text-xs text-muted-foreground">
              Your material is large, so it was compared in parts — sources far apart may not have been compared.
            </p>
          )}
          {check &&
            (check.conflicts.length === 0 ? (
              <p className="text-sm text-sage">No contradictions found.</p>
            ) : (
              <ul className="space-y-3">
                {check.conflicts.map((c, i) => (
                  <li key={i} className="space-y-1.5 rounded-md border px-3 py-2">
                    <p className="text-sm font-medium">{c.topic}</p>
                    <ul className="space-y-1">
                      {c.claims.map((claim, j) => (
                        <li key={j} className="text-sm">
                          {claim.source ? (
                            <SourceLink source={claim.source} className="mr-1" />
                          ) : (
                            <span className="mr-1 text-xs text-muted-foreground">{claim.name}:</span>
                          )}
                          <span>
                            “<MathText text={claim.says} />”
                          </span>
                        </li>
                      ))}
                    </ul>
                    {c.explanation && (
                      <p className="text-sm text-muted-foreground">
                        {c.likelyCorrect && <span className="font-medium text-foreground">Likely right: {c.likelyCorrect.title}. </span>}
                        <MathText text={c.explanation} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
