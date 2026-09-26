"use client";

import { Explain } from "@/components/Explain";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Code2, LoaderCircle, Trash2 } from "lucide-react";
import type { StudyPlan } from "@/lib/studyPlan/types";
import { CODE_LANGUAGE_NAMES, CODE_LANGUAGES, type CodeLanguage } from "@/lib/code/types";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SetSummary {
  id: number;
  title: string;
  language: CodeLanguage;
  created_at: string;
  total: number;
  done: number;
}

function CodeInner() {
  const { courseId } = useParams<{ courseId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const [language, setLanguage] = useState<CodeLanguage>("python");
  const [chapterId, setChapterId] = useState(search.get("chapterId") ?? "");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: detail } = useSWR<{ course: { name: string }; studyPlan: StudyPlan | null }>(`/api/courses/${courseId}`);
  const { data, mutate } = useSWR<{ sets: SetSummary[] }>(`/api/courses/${courseId}/code`);
  const chapters = [...(detail?.studyPlan?.chapters ?? [])].sort((a, b) => a.position - b.position);

  async function create() {
    setBusy(true);
    const res = await fetch(`/api/courses/${courseId}/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, chapterId: chapterId ? Number(chapterId) : null, topic }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't write the exercises");
      return;
    }
    router.push(`/courses/${courseId}/code/${body.set.id}`);
  }

  async function remove(id: number) {
    const res = await fetch(`/api/code-sets/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't delete that set");
    void mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline">
          ← {detail?.course.name ?? "Course"}
        </Link>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <Code2 className="size-6 text-focus" />
          Code exercises
        </h1>
        <p className="text-sm text-muted-foreground">
          Write real code and run it against tests, right here in the browser. Each set builds from a warm-up to a
          harder exercise, with hints when you&apos;re stuck. Finished exercises join your reviews.
        </p>
      </div>

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-3 py-4">
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={language} onValueChange={(v) => v && setLanguage(v as CodeLanguage)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: CodeLanguage) => CODE_LANGUAGE_NAMES[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CODE_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {CODE_LANGUAGE_NAMES[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code-topic">{chapters.length > 0 ? "Chapter or topic" : "Topic"}</Label>
              {chapters.length > 0 && (
                <Select value={chapterId || "none"} onValueChange={(v) => setChapterId(!v || v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => chapters.find((c) => String(c.id) === v)?.title ?? "No chapter — type a topic"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No chapter — type a topic</SelectItem>
                    {chapters.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!chapterId && (
                <Input
                  id="code-topic"
                  value={topic}
                  maxLength={200}
                  placeholder="e.g. List comprehensions"
                  onChange={(e) => setTopic(e.target.value)}
                />
              )}
            </div>
          </div>
          <Explain id="code.write">
            <Button disabled={!aiEnabled || busy || (!chapterId && !topic.trim())} onClick={() => void create()}>
              {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
              {busy ? "Writing exercises…" : "Write exercises"}
            </Button>
          </Explain>
          {!aiEnabled && <p className="text-xs text-muted-foreground">This needs AI — turn it on in Settings.</p>}
          <p className="text-xs text-muted-foreground">
            Code runs only in your browser, cut off from the internet. Python downloads once, the first time you run it.
          </p>
        </CardContent>
      </Card>

      {!!data?.sets.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Your exercise sets</h2>
          <ul className="divide-y divide-border/60">
            {data.sets.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
                <Link href={`/courses/${courseId}/code/${s.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {s.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.done}/{s.total} done · {s.created_at.slice(0, 10)}
                </span>
                <Button size="icon-xs" variant="ghost" aria-label={`Delete ${s.title}`} onClick={() => void remove(s.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function CodePage() {
  return (
    <Suspense fallback={null}>
      <CodeInner />
    </Suspense>
  );
}
