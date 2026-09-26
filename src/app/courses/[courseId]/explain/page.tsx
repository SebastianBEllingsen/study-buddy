"use client";

import { Explain } from "@/components/Explain";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { LoaderCircle, MessageCircleQuestion, NotebookPen } from "lucide-react";
import type { StudyPlan } from "@/lib/studyPlan/types";
import type { ExplainKind, ExplainSession } from "@/lib/explain/types";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const KIND_TEXT: Record<ExplainKind, { title: string; body: string }> = {
  blurt: {
    title: "Blurt",
    body: "Close your notes and write down everything you remember about the topic. The gaps get marked and become flashcards.",
  },
  feynman: {
    title: "Explain it (Feynman)",
    body: "Explain the topic to a curious novice who asks up to five probing questions. You'll see what you couldn't explain.",
  },
};

function ExplainStart() {
  const { courseId } = useParams<{ courseId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const [kind, setKind] = useState<ExplainKind>(search.get("kind") === "feynman" ? "feynman" : "blurt");
  const [chapterId, setChapterId] = useState<string>(search.get("chapterId") ?? "");
  const [topic, setTopic] = useState(search.get("topic") ?? "");
  const [starting, setStarting] = useState(false);
  const { data: detail } = useSWR<{ course: { name: string }; studyPlan: StudyPlan | null }>(`/api/courses/${courseId}`);
  const { data: history } = useSWR<{ sessions: ExplainSession[] }>(`/api/courses/${courseId}/explain`);
  const chapters = [...(detail?.studyPlan?.chapters ?? [])].sort((a, b) => a.position - b.position);

  async function start() {
    setStarting(true);
    const res = await fetch(`/api/courses/${courseId}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, chapterId: chapterId ? Number(chapterId) : null, topic }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setStarting(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't start");
      return;
    }
    router.push(`/courses/${courseId}/explain/${body.session.id}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}`} className="text-sm text-muted-foreground hover:underline">
          ← {detail?.course.name ?? "Course"}
        </Link>
        <h1 className="font-heading text-2xl font-semibold">Explain from memory</h1>
        <p className="text-sm text-muted-foreground">
          Recalling and explaining without notes shows what you actually know — and every gap becomes a card for
          spaced review.
        </p>
      </div>

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-4 py-4">
          <ToggleGroup value={[kind]} onValueChange={(v: string[]) => v[0] && setKind(v[0] as ExplainKind)} variant="outline" size="sm">
            <Explain id="explain.blurt">
              <ToggleGroupItem value="blurt">
                <NotebookPen className="size-3.5" />
                Blurt
              </ToggleGroupItem>
            </Explain>
            <Explain id="explain.feynman">
              <ToggleGroupItem value="feynman">
                <MessageCircleQuestion className="size-3.5" />
                Explain it
              </ToggleGroupItem>
            </Explain>
          </ToggleGroup>
          <p className="text-sm text-muted-foreground">{KIND_TEXT[kind].body}</p>

          {chapters.length > 0 && (
            <div className="space-y-1.5">
              <Label>Chapter</Label>
              <Select value={chapterId || "none"} onValueChange={(v) => setChapterId(!v || v === "none" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => chapters.find((c) => String(c.id) === v)?.title ?? "No chapter — type a topic"}
                  </SelectValue>
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
            </div>
          )}
          {!chapterId && (
            <div className="space-y-1.5">
              <Label htmlFor="explain-topic">Topic</Label>
              <Input
                id="explain-topic"
                value={topic}
                maxLength={200}
                placeholder="e.g. Hash tables"
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
          )}
          <Button onClick={() => void start()} disabled={starting || !aiEnabled || (!chapterId && !topic.trim())}>
            {starting && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
            Start {KIND_TEXT[kind].title.toLowerCase()}
          </Button>
          {!aiEnabled && <p className="text-xs text-muted-foreground">This needs AI — turn it on in Settings.</p>}
        </CardContent>
      </Card>

      {!!history?.sessions.length && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Earlier sessions</h2>
          <ul className="divide-y divide-border/60">
            {history.sessions.map((s) => {
              const missing = s.result?.coverage.filter((c) => c.status !== "covered").length ?? null;
              return (
                <li key={s.id}>
                  <Link href={`/courses/${courseId}/explain/${s.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:underline">
                    <span className="truncate">
                      {KIND_TEXT[s.kind].title} · {s.topic}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {s.status === "open" ? "Not finished" : `${missing} gap${missing === 1 ? "" : "s"}`} · {s.created_at.slice(0, 10)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function ExplainStartPage() {
  return (
    <Suspense fallback={null}>
      <ExplainStart />
    </Suspense>
  );
}
