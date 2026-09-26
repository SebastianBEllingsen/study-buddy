"use client";

import { Explain } from "@/components/Explain";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarCheck, CheckCircle2, CircleAlert, LoaderCircle, PartyPopper, XCircle } from "lucide-react";
import { cn } from "cn";
import type { FlashcardResult } from "@/lib/models";
import type { AttemptResultEntry } from "@/lib/quizGrading";
import type { QueueCounts, QueueEntry } from "@/lib/review/queueBuild";
import type { Confidence } from "@/lib/review/types";
import { calibrationMessage } from "@/lib/review/calibration";
import { localDayStart, reinsertLater, summarizeSession, type SessionAnswer } from "@/lib/review/session";
import { tap } from "@/lib/haptics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CardFace } from "@/components/CardFace";
import { MathText } from "@/components/MathText";
import { handleFlashcardKeyDown } from "@/components/FlashcardViewer";
import { ConfidencePicker } from "./ConfidencePicker";
import { WhyPrompt } from "./WhyPrompt";
import { ReportWrongButton } from "@/components/sources/ReportWrongButton";
import { SourceLink } from "@/components/sources/SourceLink";
import { useTodaySession } from "@/components/today/todayStore";
import { NextTodayStep } from "@/components/today/NextTodayStep";

const RATINGS: { result: FlashcardResult; label: string; className: string }[] = [
  { result: "again", label: "Again", className: "bg-clay/10 text-clay hover:bg-clay/20" },
  { result: "hard", label: "Hard", className: "bg-amber/10 text-amber hover:bg-amber/20" },
  { result: "good", label: "Good", className: "bg-sage/10 text-sage hover:bg-sage/20" },
  { result: "easy", label: "Easy", className: "bg-focus/10 text-focus hover:bg-focus/20" },
];

type QuestionAnswer = number | string | number[] | null;

async function postAnswer(body: Record<string, unknown>) {
  try {
    const res = await fetch("/api/review/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't save that answer — try again");
      return null;
    }
    return data as { result?: AttemptResultEntry; scheduled: boolean };
  } catch {
    toast.error("Couldn't save that answer — try again");
    return null;
  }
}

function EntryLabel({ entry }: { entry: QueueEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="truncate">
        {entry.courseName} · {entry.itemTitle}
      </span>
      {entry.concept && <Badge variant="secondary">{entry.concept}</Badge>}
      {entry.isNew && <Badge variant="outline">New</Badge>}
    </div>
  );
}

// One review session over the queue from /api/review/queue: cards and
// questions from every set that's due, interleaved. Whatever is missed comes
// back a few items later until it's right; only the first answer to each
// is scheduled.
export type ReviewMode = { mode: "due" } | { mode: "mistakes" } | { mode: "concept"; concept: string };

export function ReviewSession({ courseId, focus = { mode: "due" } }: { courseId: number | null; focus?: ReviewMode }) {
  const [dayStart] = useState(() => localDayStart());
  const params = new URLSearchParams({ dayStart });
  if (courseId !== null) params.set("courseId", String(courseId));
  if (focus.mode !== "due") params.set("mode", focus.mode);
  if (focus.mode === "concept") params.set("concept", focus.concept);
  // Fetched when the page opens and on "Check for more" — never refreshed
  // under a running session, which works on its own copy (below).
  const { data, error: loadError, isValidating, mutate } = useSWR<{ entries: QueueEntry[]; counts: QueueCounts }>(
    `/api/review/queue?${params}`,
    { revalidateOnMount: true, revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }
  );
  const [seededFrom, setSeededFrom] = useState<typeof data>(undefined);
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [position, setPosition] = useState(0);
  const [answers, setAnswers] = useState<SessionAnswer[]>([]);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState<QuestionAnswer>(null);
  const [result, setResult] = useState<AttemptResultEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const counts = data?.counts ?? null;
  const todayActive = !!useTodaySession();

  // Seeded only from a finished fetch, so a cached queue from an earlier
  // visit (or the one just worked through) never flashes back up.
  if (data && !isValidating && data !== seededFrom) {
    setSeededFrom(data);
    setQueue(data.entries);
    setPosition(0);
    setAnswers([]);
  }

  function load() {
    setQueue(null);
    setSeededFrom(undefined);
    void mutate();
  }

  const entry = queue?.[position];
  const answeredKeys = new Set(answers.map((a) => a.key));

  // Reported wrong: it leaves this session (every later copy of it too)
  // without counting as an answer.
  function dropReported() {
    if (!entry || !queue) return;
    const key = entry.key;
    setQueue([...queue.slice(0, position), ...queue.slice(position + 1).filter((e) => e.key !== key)]);
    setConfidence(null);
    setFlipped(false);
    setAnswer(null);
    setResult(null);
  }

  function entryFooter() {
    if (!entry) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {entry.source ? <SourceLink source={entry.source} /> : <span />}
        <ReportWrongButton key={entry.key} itemId={entry.itemId} index={entry.index} onReported={dropReported} />
      </div>
    );
  }

  function advance(correct: boolean) {
    if (!entry || !queue) return;
    const firstTry = !answeredKeys.has(entry.key);
    setAnswers((prev) => [...prev, { key: entry.key, firstTry, correct, confidence: firstTry ? confidence : null }]);
    if (!correct) setQueue(reinsertLater(queue, position, entry));
    setPosition((p) => p + 1);
    setConfidence(null);
    setFlipped(false);
    setAnswer(null);
    setResult(null);
  }

  async function rateCard(rating: FlashcardResult) {
    if (!entry || entry.kind !== "card" || busy) return;
    setBusy(true);
    const saved = await postAnswer({
      itemId: entry.itemId,
      kind: "card",
      index: entry.index,
      result: rating,
      confidence,
      record: !answeredKeys.has(entry.key),
    });
    setBusy(false);
    if (!saved) return;
    advance(rating !== "again");
  }

  async function checkQuestion() {
    if (!entry || entry.kind !== "question" || busy) return;
    setBusy(true);
    const saved = await postAnswer({
      itemId: entry.itemId,
      kind: "question",
      index: entry.index,
      answer,
      confidence,
      record: !answeredKeys.has(entry.key),
    });
    setBusy(false);
    if (!saved?.result) return;
    tap(saved.result.correct ? 15 : [15, 80, 15]);
    setResult(saved.result);
  }

  useEffect(() => {
    if (result) continueRef.current?.focus();
  }, [result]);

  // Cards: space flips, 1–3 before the reveal pick a confidence, 1–4 after
  // it rate — the same keys as a deck.
  useEffect(() => {
    if (entry?.kind !== "card") return;
    function onKeyDown(e: KeyboardEvent) {
      handleFlashcardKeyDown({
        event: e,
        flipped,
        onFlip: () => setFlipped((f) => !f),
        onRate: rateCard,
        onConfidence: (c) => {
          setConfidence(c);
          setFlipped(true);
        },
      });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // rateCard closes over the current entry, which `position` tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, position, entry?.kind, confidence, busy]);

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load your reviews</AlertTitle>
        <AlertDescription>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!queue) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <Card className="items-center gap-3 py-12 text-center">
        <CalendarCheck className="size-8 animate-pop-in text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">
            {focus.mode === "mistakes"
              ? "No open mistakes."
              : focus.mode === "concept"
                ? "Nothing is tagged with this concept."
                : "Nothing to review right now."}
          </p>
          {focus.mode === "due" && (
            <p className="text-sm text-muted-foreground">
              Cards and quiz questions come back here when they&apos;re due. Quiz questions join after you first
              answer them in a quiz.
            </p>
          )}
        </div>
      </Card>
    );
  }

  if (!entry) {
    const summary = summarizeSession(answers);
    const calibration = calibrationMessage(summary.calibration);
    const hasMistakes = summary.relearned > 0 || summary.calibration.sureWrong > 0;
    return (
      <Card className="items-center gap-3 py-12 text-center">
        <PartyPopper className="size-8 animate-pop-in text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">
            Session done — {summary.reviewed} item{summary.reviewed === 1 ? "" : "s"} reviewed.
          </p>
          <p className="text-sm text-muted-foreground">
            {summary.firstTryCorrect} right on the first try
            {summary.relearned > 0 && `, ${summary.relearned} relearned until you got them`}.
          </p>
          {calibration && <p className="text-sm text-muted-foreground">{calibration}</p>}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {hasMistakes && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={courseId === null ? "/mistakes" : `/mistakes?courseId=${courseId}`} />}
            >
              Open the mistake log
            </Button>
          )}
          <NextTodayStep />
          <Button variant={todayActive ? "outline" : "default"} onClick={load}>
            Check for more
          </Button>
        </div>
      </Card>
    );
  }

  const remaining = queue.length - position;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {remaining} left
          {counts && position === 0 && focus.mode === "due" && (
            <>
              {" "}
              · {counts.dueCards + counts.dueQuestions} due, {counts.newCards} new
            </>
          )}
        </span>
        {answeredKeys.has(entry.key) && <Badge variant="outline">Again — until you get it</Badge>}
      </div>

      {entry.kind === "card" ? (
        <div className="space-y-3">
          <Card
            role="button"
            tabIndex={0}
            onClick={() => {
              if (window.getSelection()?.toString().trim()) return;
              tap(10);
              setFlipped((f) => !f);
            }}
            className="min-h-40 cursor-pointer gap-4 px-6 py-6 text-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <EntryLabel entry={entry} />
            <CardFace text={entry.card.front} media={entry.card.frontMedia} active={!flipped} />
            {flipped && (
              <div className="animate-pop-in border-t border-border pt-4">
                <CardFace text={entry.card.back} media={entry.card.backMedia} active={flipped} />
              </div>
            )}
          </Card>
          {flipped && <WhyPrompt key={entry.key} itemId={entry.itemId} cardIndex={entry.index} />}
          {flipped && entryFooter()}
          {flipped ? (
            <div className="flex flex-wrap gap-2">
              {RATINGS.map(({ result: rating, label, className }, i) => (
                <Explain key={rating} id={`rating.${rating}`}>
                  <Button variant="ghost" disabled={busy} onClick={() => void rateCard(rating)} className={className}>
                    {label}
                    <kbd className="ml-1 rounded border border-current/30 px-1 font-sans text-[0.65rem] opacity-60">{i + 1}</kbd>
                  </Button>
                </Explain>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Recall the answer, then reveal it</p>
              <ConfidencePicker
                value={confidence}
                onChange={(c) => {
                  setConfidence(c);
                  setFlipped(true);
                }}
                shortcuts
              />
            </div>
          )}
        </div>
      ) : (
        <Card className="gap-4 px-6 py-6">
          <EntryLabel entry={entry} />
          <p className="leading-snug">
            <MathText text={entry.question.question} />
          </p>
          {entry.question.type === "mcq" ? (
            <RadioGroup
              value={typeof answer === "number" ? String(answer) : ""}
              onValueChange={(v) => setAnswer(Number(v))}
              disabled={!!result}
            >
              {entry.question.options.map((option, i) => (
                <Label key={i} className="flex items-center gap-2 text-sm font-normal">
                  <RadioGroupItem value={String(i)} />
                  <MathText text={option} />
                </Label>
              ))}
            </RadioGroup>
          ) : entry.question.type === "multi_select" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Select {entry.question.answerCount}.</p>
              {entry.question.options.map((option, i) => {
                const selected = Array.isArray(answer) ? answer : [];
                const checked = selected.includes(i);
                return (
                  <Label key={i} className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox
                      checked={checked}
                      disabled={!!result}
                      onCheckedChange={() => setAnswer(checked ? selected.filter((x) => x !== i) : [...selected, i])}
                    />
                    <MathText text={option} />
                  </Label>
                );
              })}
            </div>
          ) : (
            <Textarea
              rows={3}
              disabled={!!result}
              value={typeof answer === "string" ? answer : ""}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void checkQuestion();
              }}
            />
          )}

          {(!result || confidence) && (
            <ConfidencePicker value={confidence} onChange={setConfidence} disabled={!!result} />
          )}

          {result ? (
            <>
              <Alert
                className={cn(
                  "animate-pop-in",
                  result.correct
                    ? "border-sage/30 bg-sage/5"
                    : result.verdict === "partial"
                      ? "border-amber/30 bg-amber/5"
                      : "border-clay/30 bg-clay/5"
                )}
              >
                {result.correct ? (
                  <CheckCircle2 className="text-sage" />
                ) : result.verdict === "partial" ? (
                  <CircleAlert className="text-amber" />
                ) : (
                  <XCircle className="text-clay" />
                )}
                <AlertTitle>
                  {result.correct ? "Correct" : result.verdict === "partial" ? "Partially correct" : "Incorrect"}
                </AlertTitle>
                <AlertDescription className="space-y-1">
                  {!result.correct && (
                    <p>
                      Answer: <MathText text={result.correctAnswer} />
                    </p>
                  )}
                  {result.feedback && result.type === "short_answer" && (
                    <p>
                      <MathText text={result.feedback} />
                    </p>
                  )}
                  {result.explanation && (
                    <p>
                      <MathText text={result.explanation} />
                    </p>
                  )}
                </AlertDescription>
              </Alert>
              <Button ref={continueRef} className="self-start" onClick={() => advance(result.correct)}>
                Continue
              </Button>
              {entryFooter()}
            </>
          ) : (
            <Button className="self-start" disabled={busy} onClick={() => void checkQuestion()}>
              {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
              Check
            </Button>
          )}
        </Card>
      )}
      {entry.kind === "card" && (
        <p className="text-xs text-muted-foreground">
          Space reveals · 1–3 say how sure you are · 1–4 rate
        </p>
      )}
    </div>
  );
}
