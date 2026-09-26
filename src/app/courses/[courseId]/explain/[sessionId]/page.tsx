"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, LoaderCircle, TriangleAlert, XCircle } from "lucide-react";
import { cn } from "cn";
import { MAX_NOVICE_QUESTIONS, type ExplainSession } from "@/lib/explain/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/MathText";

const STATUS = {
  covered: { icon: CheckCircle2, className: "text-sage", label: "Covered" },
  partial: { icon: CircleAlert, className: "text-amber", label: "Partly" },
  missing: { icon: XCircle, className: "text-clay", label: "Missing" },
} as const;

function Result({ session, courseId }: { session: ExplainSession; courseId: string }) {
  const result = session.result!;
  const covered = result.coverage.filter((c) => c.status === "covered").length;
  return (
    <div className="space-y-4">
      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-2 py-4">
          <p className="text-2xl font-semibold tabular-nums">
            {covered} / {result.coverage.length} <span className="text-base font-normal text-muted-foreground">ideas covered</span>
          </p>
          {result.summary && <p className="text-sm">{result.summary}</p>}
        </CardContent>
      </Card>
      <ul className="space-y-2">
        {result.coverage.map((c, i) => {
          const s = STATUS[c.status];
          return (
            <li key={i} className="flex gap-2 text-sm">
              <s.icon className={cn("mt-0.5 size-4 shrink-0", s.className)} aria-label={s.label} />
              <span>
                <span className="font-medium">{c.concept}</span>
                {c.note && <span className="text-muted-foreground"> — {c.note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {result.errors.length > 0 && (
        <div className="space-y-1 rounded-md bg-clay/10 px-3 py-2 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-clay">
            <TriangleAlert className="size-4" />
            Things to correct
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {result.errors.map((e, i) => (
              <li key={i}>
                <MathText text={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {session.practice_item_id !== null && result.cards.length > 0 && (
          <Button nativeButton={false} render={<Link href={`/items/${session.practice_item_id}`} />}>
            {result.cards.length} gap card{result.cards.length === 1 ? "" : "s"} added — see the deck
          </Button>
        )}
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href={`/courses/${courseId}/explain?kind=${session.kind === "blurt" ? "feynman" : "blurt"}${session.chapter_id ? `&chapterId=${session.chapter_id}` : `&topic=${encodeURIComponent(session.topic)}`}`} />}
        >
          {session.kind === "blurt" ? "Now explain it to a novice" : "Now blurt it"}
        </Button>
      </div>
    </div>
  );
}

export default function ExplainSessionPage() {
  const { courseId, sessionId } = useParams<{ courseId: string; sessionId: string }>();
  const key = `/api/explain-sessions/${sessionId}`;
  const { data, error, mutate } = useSWR<{ session: ExplainSession }>(key, { revalidateOnFocus: false });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(finish = false) {
    setBusy(true);
    const res = await fetch(key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, finish }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Something went wrong");
      return;
    }
    setText("");
    void mutate(body, { revalidate: false });
  }

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load this session.</p>;
  if (!data) return <Skeleton className="h-64 rounded-xl" />;
  const { session } = data;
  const asked = session.messages.filter((m) => m.role === "novice").length;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}/explain`} className="text-sm text-muted-foreground hover:underline">
          ← Explain from memory
        </Link>
        <h1 className="font-heading text-2xl font-semibold">
          {session.kind === "blurt" ? "Blurt" : "Explain it"}: {session.topic}
        </h1>
        {session.status === "open" && (
          <p className="text-sm text-muted-foreground">
            {session.kind === "blurt"
              ? "No notes. Write everything you can remember — definitions, how things connect, examples, formulas. Aim for about five minutes."
              : "Explain it as if to someone clever who's never heard of it. Plain words, examples, and why things work."}
          </p>
        )}
      </div>

      {session.kind === "feynman" && session.messages.length > 0 && (
        <ul className="space-y-3">
          {session.messages.map((m, i) => (
            <li
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm",
                m.role === "student" ? "ml-auto bg-focus/10" : "bg-muted"
              )}
            >
              <MathText text={m.text} />
            </li>
          ))}
        </ul>
      )}

      {session.status === "done" && session.result ? (
        <Result session={session} courseId={courseId} />
      ) : (
        <div className="space-y-2">
          <Textarea
            rows={session.kind === "blurt" ? 14 : 5}
            value={text}
            disabled={busy}
            placeholder={
              session.kind === "blurt"
                ? "Everything you remember…"
                : asked === 0
                  ? "Start explaining…"
                  : "Answer the question…"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void send();
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {session.kind === "feynman" && `Question ${Math.min(asked, MAX_NOVICE_QUESTIONS)} of ${MAX_NOVICE_QUESTIONS}`}
            </span>
            <div className="flex gap-2">
              {session.kind === "feynman" && asked > 0 && (
                <Explain id="explain.finish">
                  <Button variant="ghost" disabled={busy} onClick={() => void send(true)}>
                    I&apos;m done — show my gaps
                  </Button>
                </Explain>
              )}
              <Button disabled={busy || !text.trim()} onClick={() => void send()}>
                {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
                {session.kind === "blurt" ? "Check what I missed" : asked >= MAX_NOVICE_QUESTIONS ? "Finish" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
