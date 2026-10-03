"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Eye, SkipForward, XCircle } from "lucide-react";
import { cn } from "cn";
import { MathText } from "@/components/MathText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createStoredState } from "@/lib/createStoredState";
import { ANSWER_HINT, checkAnswer, type Verdict } from "@/lib/drills/answer";
import { GENERATORS, randomDrill, solutionAnswer, TOPIC_NAMES, type Drill, type Topic } from "@/lib/drills/generators";

// Practice with fresh numbers every time. Answers are worked out in code, so
// there's no AI in the loop — it's instant, free, and never wrong about its own
// key. Your streak and accuracy are kept on this device.

const TOPICS = Object.keys(TOPIC_NAMES) as Topic[];

interface Tally {
  answered: number;
  correct: number;
}
interface Stats {
  streak: number;
  best: number;
  all: Tally;
  byTopic: Record<Topic, Tally>;
}

const EMPTY_TALLY: Tally = { answered: 0, correct: 0 };
const EMPTY_STATS: Stats = {
  streak: 0,
  best: 0,
  all: EMPTY_TALLY,
  byTopic: { algebra: EMPTY_TALLY, calculus: EMPTY_TALLY, modelling: EMPTY_TALLY, quantum: EMPTY_TALLY },
};

const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const tally = (v: unknown): Tally => {
  const o = (v ?? {}) as Partial<Tally>;
  const answered = count(o.answered);
  return { answered, correct: Math.min(answered, count(o.correct)) };
};

const statsStore = createStoredState<Stats>(
  "studybuddy-drill-stats",
  (raw) => {
    const o = (raw ?? {}) as Partial<Stats>;
    const by = (o.byTopic ?? {}) as Partial<Record<Topic, unknown>>;
    return {
      streak: count(o.streak),
      best: count(o.best),
      all: tally(o.all),
      byTopic: Object.fromEntries(TOPICS.map((t) => [t, tally(by[t])])) as Record<Topic, Tally>,
    };
  },
  EMPTY_STATS
);

// One scored answer, right or wrong.
export function scored(stats: Stats, topic: Topic, correct: boolean): Stats {
  const bump = (t: Tally): Tally => ({ answered: t.answered + 1, correct: t.correct + (correct ? 1 : 0) });
  const streak = correct ? stats.streak + 1 : 0;
  return { streak, best: Math.max(stats.best, streak), all: bump(stats.all), byTopic: { ...stats.byTopic, [topic]: bump(stats.byTopic[topic]) } };
}

interface Attempt {
  input: string;
  verdict: Verdict | null;
  // A right or wrong answer has been counted for this problem.
  counted: boolean;
  solved: boolean;
  revealed: boolean;
}
const FRESH: Attempt = { input: "", verdict: null, counted: false, solved: false, revealed: false };

export function DrillRunner() {
  const stats = statsStore.useValue();
  const [topic, setTopic] = useState<Topic | "all">("all");
  const [drill, setDrill] = useState<Drill>(() => randomDrill("all"));
  const [attempt, setAttempt] = useState<Attempt>(FRESH);
  const inputRef = useRef<HTMLInputElement>(null);

  function next(choice: Topic | "all" = topic) {
    setDrill(randomDrill(choice, Math.random, drill.generator));
    setAttempt(FRESH);
    // Straight back to typing.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function chooseTopic(choice: Topic | "all") {
    setTopic(choice);
    next(choice);
  }

  function check() {
    if (!attempt.input.trim() || attempt.solved || attempt.revealed) return;
    const verdict = checkAnswer(drill.answer, attempt.input);
    if ((verdict === "correct" || verdict === "wrong") && !attempt.counted) {
      statsStore.write(scored(stats, drill.topic, verdict === "correct"));
    }
    setAttempt({
      ...attempt,
      verdict,
      counted: attempt.counted || verdict === "correct" || verdict === "wrong",
      solved: verdict === "correct",
    });
  }

  function reveal() {
    // Giving up before a scored answer counts as a miss.
    if (!attempt.counted) statsStore.write(scored(stats, drill.topic, false));
    setAttempt({ ...attempt, revealed: true, counted: true });
  }

  const finished = attempt.solved || attempt.revealed;
  const accuracy = (t: Tally) => (t.answered ? `${Math.round((t.correct / t.answered) * 100)}%` : "–");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">Drills</h1>
        <p className="text-sm text-muted-foreground">
          Practice with fresh numbers every time. The answers are worked out exactly in code, so there&apos;s no AI and no wrong answer key.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Topic">
        <TopicChip active={topic === "all"} onClick={() => chooseTopic("all")} detail={accuracy(stats.all)}>
          All
        </TopicChip>
        {TOPICS.map((t) => (
          <TopicChip key={t} active={topic === t} onClick={() => chooseTopic(t)} detail={accuracy(stats.byTopic[t])}>
            {TOPIC_NAMES[t]}
          </TopicChip>
        ))}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Streak <span className="font-medium text-foreground">{stats.streak}</span> (best {stats.best}) · {stats.all.correct} of {stats.all.answered} right
      </p>

      <Card className="gap-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{drill.title}</Badge>
          <Badge variant="secondary">{TOPIC_NAMES[drill.topic]}</Badge>
        </div>
        <div className="text-lg leading-relaxed">
          <MathText text={drill.statement} />
        </div>

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <label htmlFor="drill-answer" className="text-sm font-medium">
            Your answer
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="drill-answer"
              ref={inputRef}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={attempt.input}
              disabled={finished}
              onChange={(e) => setAttempt({ ...attempt, input: e.target.value, verdict: attempt.solved ? attempt.verdict : null })}
              className="max-w-sm flex-1 font-mono"
            />
            {!finished && (
              <Button type="submit" disabled={!attempt.input.trim()}>
                Check
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{ANSWER_HINT[drill.answer.kind]}</p>
        </form>

        <Feedback verdict={attempt.verdict} revealed={attempt.revealed} kind={drill.answer.kind} />

        {attempt.revealed && (
          <p className="rounded-md bg-sage/10 px-3 py-2 text-sm">
            <span className="font-medium">Answer: </span>
            <MathText text={solutionAnswer(drill)} />
          </p>
        )}
        {finished && (
          <details className="text-sm" open={attempt.revealed}>
            <summary className="cursor-pointer text-muted-foreground">Worked solution</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              {drill.solution.map((step, i) => (
                <li key={i}>
                  <MathText text={step} />
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {finished ? (
            <Button onClick={() => next()} autoFocus>
              Next problem
            </Button>
          ) : (
            <>
              {attempt.verdict === "wrong" && (
                <Button variant="outline" onClick={reveal}>
                  <Eye className="size-4" />
                  Show the solution
                </Button>
              )}
              <Button variant="ghost" onClick={() => next()}>
                <SkipForward className="size-4" />
                Skip
              </Button>
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{GENERATORS.length} kinds of problem</span>
        </div>
      </Card>
    </div>
  );
}

function TopicChip({ active, onClick, detail, children }: { active: boolean; onClick: () => void; detail: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm transition-colors", active ? "border-focus bg-focus/10 font-medium" : "hover:bg-muted")}
    >
      {children}
      <span className="text-xs text-muted-foreground tabular-nums" title="Your accuracy here">
        {detail}
      </span>
    </button>
  );
}

function Feedback({ verdict, revealed, kind }: { verdict: Verdict | null; revealed: boolean; kind: keyof typeof ANSWER_HINT }) {
  if (revealed || !verdict) return null;
  if (verdict === "correct") {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-sage">
        <CheckCircle2 className="size-4" />
        Correct.
      </p>
    );
  }
  if (verdict === "close") {
    return (
      <p className="flex items-center gap-2 text-sm text-amber">
        <CircleAlert className="size-4 shrink-0" />
        Close, but that looks rounded. Give the exact value, like a fraction.
      </p>
    );
  }
  if (verdict === "unreadable") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleAlert className="size-4 shrink-0" />
        Couldn&apos;t read that. {ANSWER_HINT[kind]}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-clay">
      <XCircle className="size-4 shrink-0" />
      Not quite. Try again, or look at the solution.
    </p>
  );
}
