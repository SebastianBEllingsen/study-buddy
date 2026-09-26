"use client";

import { Explain } from "@/components/Explain";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Footprints, LoaderCircle, Shuffle, Trash2 } from "lucide-react";
import type { StudyPlan } from "@/lib/studyPlan/types";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SetSummary {
  id: number;
  kind: "coach" | "mixed";
  title: string;
  created_at: string;
  total: number;
  done: number;
}

function ProblemsInner() {
  const { courseId } = useParams<{ courseId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const [chapterId, setChapterId] = useState(search.get("chapterId") ?? "");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState<"coach" | "mixed" | null>(null);
  const { data: detail } = useSWR<{ course: { name: string }; studyPlan: StudyPlan | null }>(`/api/courses/${courseId}`);
  const { data, mutate } = useSWR<{ sets: SetSummary[] }>(`/api/courses/${courseId}/problems`);
  const chapters = [...(detail?.studyPlan?.chapters ?? [])].sort((a, b) => a.position - b.position);

  async function create(kind: "coach" | "mixed") {
    setBusy(kind);
    const res = await fetch(`/api/courses/${courseId}/problems`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "mixed" ? { kind } : { kind, chapterId: chapterId ? Number(chapterId) : null, topic }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't write the problems");
      return;
    }
    router.push(`/courses/${courseId}/problems/${body.set.id}`);
  }

  async function remove(id: number) {
    const res = await fetch(`/api/problem-sets/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't delete that set");
    void mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline">
          ← {detail?.course.name ?? "Course"}
        </Link>
        <h1 className="font-heading text-2xl font-semibold">Problem solving</h1>
        <p className="text-sm text-muted-foreground">
          Learn a method by fading support: study a worked example, fill in the missing steps of a second one, then
          solve two on your own with hints if you need them. Mixed sets shuffle problems from different topics so
          you practise spotting which method to use.
        </p>
        <p className="text-sm text-muted-foreground">
          Learning to program?{" "}
          <Link href={`/courses/${courseId}/code`} className="text-foreground underline-offset-2 hover:underline">
            Code exercises
          </Link>{" "}
          run your code against tests instead.
        </p>
      </div>

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-3 py-4">
          <h2 className="flex items-center gap-2 font-medium">
            <Footprints className="size-4 text-focus" />
            Coached set
          </h2>
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
            <div className="space-y-1.5">
              <Label htmlFor="problem-topic">Topic</Label>
              <Input
                id="problem-topic"
                value={topic}
                maxLength={200}
                placeholder="e.g. Solving recurrence relations"
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
          )}
          <Explain id="problems.coached">
          <Button disabled={!aiEnabled || busy !== null || (!chapterId && !topic.trim())} onClick={() => void create("coach")}>
            {busy === "coach" && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
            {busy === "coach" ? "Writing problems…" : "Start a coached set"}
          </Button>
          </Explain>
        </CardContent>
      </Card>

      <Card elevation="flat" className="py-0">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-medium">
              <Shuffle className="size-4 text-focus" />
              Mixed set
            </h2>
            <p className="text-sm text-muted-foreground">Problems from your weakest topics, shuffled.</p>
          </div>
          <Explain id="problems.mixed">
          <Button variant="outline" disabled={!aiEnabled || busy !== null} onClick={() => void create("mixed")}>
            {busy === "mixed" && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
            {busy === "mixed" ? "Writing problems…" : "Start a mixed set"}
          </Button>
          </Explain>
        </CardContent>
      </Card>
      {!aiEnabled && <p className="text-xs text-muted-foreground">This needs AI — turn it on in Settings.</p>}

      {!!data?.sets.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Your problem sets</h2>
          <ul className="divide-y divide-border/60">
            {data.sets.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
                <Link href={`/courses/${courseId}/problems/${s.id}`} className="min-w-0 flex-1 truncate hover:underline">
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

export default function ProblemsPage() {
  return (
    <Suspense fallback={null}>
      <ProblemsInner />
    </Suspense>
  );
}
