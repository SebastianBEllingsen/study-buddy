"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Eye, Lightbulb, LoaderCircle, XCircle } from "lucide-react";
import { cn } from "cn";
import type { ProblemProgress, PublicProblem, Verdict } from "@/lib/problems/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/MathText";

interface PublicSet {
  id: number;
  course_id: number;
  kind: "coach" | "mixed";
  title: string;
  problems: PublicProblem[];
  progress: ProblemProgress[];
  practice_item_id: number | null;
}

const STAGE_LABEL = { worked: "Worked example", faded: "Fill in the gaps", independent: "On your own" } as const;
const STAGE_NOTE = {
  worked: "Read each step and ask yourself why it follows from the one before.",
  faded: "The highlighted steps are blank — work them out.",
  independent: "Solve it yourself. Hints come one step at a time.",
} as const;

function VerdictLine({ verdict, feedback }: { verdict: Verdict; feedback: string }) {
  const Icon = verdict === "correct" ? CheckCircle2 : verdict === "partial" ? CircleAlert : XCircle;
  return (
    <p className="flex gap-2 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", verdict === "correct" ? "text-sage" : verdict === "partial" ? "text-amber" : "text-clay")} />
      <span>
        <MathText text={feedback || (verdict === "correct" ? "Correct." : "Not quite.")} />
      </span>
    </p>
  );
}

export default function ProblemSetPage() {
  const { courseId, setId } = useParams<{ courseId: string; setId: string }>();
  const key = `/api/problem-sets/${setId}`;
  const { data, error, mutate } = useSWR<{ set: PublicSet }>(key, { revalidateOnFocus: false });
  const [index, setIndex] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function act(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    const res = await fetch(key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) {
      toast.error(json?.error ?? "Something went wrong");
      return;
    }
    void mutate(json, { revalidate: false });
  }

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load this problem set.</p>;
  if (!data) return <Skeleton className="h-64 rounded-xl" />;
  const { set } = data;
  const firstOpen = set.progress.findIndex((p) => !p.done);
  const current = index ?? (firstOpen === -1 ? set.problems.length - 1 : firstOpen);
  const problem = set.problems[current];
  const progress = set.progress[current];
  const allDone = set.progress.every((p) => p.done);
  const draft = (k: string) => drafts[`${current}:${k}`] ?? "";
  const setDraft = (k: string, v: string) => setDrafts((d) => ({ ...d, [`${current}:${k}`]: v }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-2">
        <Link href={`/courses/${courseId}/problems`} className="text-sm text-muted-foreground hover:underline">
          ← Problem solving
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{set.title}</h1>
        <div className="flex flex-wrap gap-1.5">
          {set.problems.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                i === current ? "border-focus bg-focus/10" : "hover:bg-muted",
                set.progress[i].done && "text-sage"
              )}
            >
              {set.progress[i].done && "✓ "}
              {i + 1}. {set.kind === "coach" ? STAGE_LABEL[p.stage] : p.concept}
            </button>
          ))}
        </div>
      </div>

      <Card className="gap-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{STAGE_LABEL[problem.stage]}</Badge>
          {set.kind === "coach" && <Badge variant="secondary">{problem.concept}</Badge>}
          <span className="text-xs text-muted-foreground">{STAGE_NOTE[problem.stage]}</span>
        </div>
        <div className="whitespace-pre-line leading-relaxed">
          <MathText text={problem.statement} />
        </div>

        {problem.stage !== "independent" || progress.done ? (
          <ol className="space-y-3">
            {problem.steps.map((step, i) => {
              const blank = problem.stage === "faded" && problem.blanks.includes(i);
              const answer = progress.stepAnswers[i];
              return (
                <li key={i} className={cn("rounded-md border px-3 py-2", blank && !step.text && "border-focus/50 bg-focus/5")}>
                  <p className="mb-1 text-xs text-muted-foreground">Step {i + 1}</p>
                  {step.text ? (
                    <div className="whitespace-pre-line text-sm">
                      <MathText text={step.text} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Textarea rows={3} value={draft(`step${i}`)} onChange={(e) => setDraft(`step${i}`, e.target.value)} placeholder="Your working for this step" />
                      {answer && <VerdictLine verdict={answer.verdict} feedback={answer.feedback} />}
                      <div className="flex flex-wrap gap-2">
                        <Explain id="problems.check">
                        <Button
                          size="sm"
                          disabled={busy !== null || !draft(`step${i}`).trim()}
                          onClick={() => void act({ action: "check", problem: current, step: i, text: draft(`step${i}`) }, `check${i}`)}
                        >
                          {busy === `check${i}` && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />}
                          Check
                        </Button>
                        </Explain>
                        {step.hint && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted-foreground">Hint</summary>
                            <MathText text={step.hint} />
                          </details>
                        )}
                        <Explain id="problems.showStep">
                          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act({ action: "reveal", problem: current, step: i }, `reveal${i}`)}>
                            <Eye className="size-3.5" />
                            Show this step
                          </Button>
                        </Explain>
                      </div>
                    </div>
                  )}
                  {blank && step.text && answer && <div className="mt-2"><VerdictLine verdict={answer.verdict} feedback={answer.feedback} /></div>}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="space-y-3">
            {problem.steps.some((s) => s.hint) && (
              <ol className="space-y-1 text-sm">
                {problem.steps.map((s, i) =>
                  s.hint ? (
                    <li key={i} className="flex gap-2">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber" />
                      <span>
                        Step {i + 1}: <MathText text={s.hint} />
                      </span>
                    </li>
                  ) : null
                )}
              </ol>
            )}
            <Textarea rows={8} value={draft("solution")} onChange={(e) => setDraft("solution", e.target.value)} placeholder="Your full solution — math like $x^2$ works." />
            {progress.solution && <VerdictLine verdict={progress.solution.verdict} feedback={progress.solution.feedback} />}
            <div className="flex flex-wrap gap-2">
              <Explain id="problems.check">
              <Button
                disabled={busy !== null || !draft("solution").trim()}
                onClick={() => void act({ action: "check", problem: current, text: draft("solution") }, "solve")}
              >
                {busy === "solve" && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
                Check my solution
              </Button>
              </Explain>
              {progress.hintsUsed < problem.steps.length && (
                <Explain id="problems.hint">
                  <Button variant="outline" disabled={busy !== null} onClick={() => void act({ action: "hint", problem: current }, "hint")}>
                    <Lightbulb className="size-4" />
                    Hint for step {progress.hintsUsed + 1}
                  </Button>
                </Explain>
              )}
              <Explain id="problems.showSolution">
                <Button variant="ghost" disabled={busy !== null} onClick={() => void act({ action: "reveal", problem: current }, "reveal")}>
                  <Eye className="size-4" />
                  Show the solution
                </Button>
              </Explain>
            </div>
          </div>
        )}

        {problem.answer && (
          <p className="rounded-md bg-sage/10 px-3 py-2 text-sm">
            <span className="font-medium">Answer: </span>
            <MathText text={problem.answer} />
          </p>
        )}
        {problem.stage === "independent" && progress.done && progress.solution && (
          <VerdictLine verdict={progress.solution.verdict} feedback={progress.solution.feedback} />
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {problem.stage === "worked" && !progress.done && (
            <Explain id="problems.studied">
              <Button onClick={() => void act({ action: "done", problem: current }, "done").then(() => setIndex(null))}>
                I&apos;ve studied it
              </Button>
            </Explain>
          )}
          {progress.done && current < set.problems.length - 1 && (
            <Button onClick={() => setIndex(current + 1)}>Next problem</Button>
          )}
        </div>
      </Card>

      {allDone && (
        <p className="text-sm text-muted-foreground">
          Set complete. The problems you solved come back in your spaced review
          {set.practice_item_id !== null && (
            <>
              {" "}
              (<Link href={`/items/${set.practice_item_id}`} className="underline">see them</Link>)
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}
