"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { QuizQuestion } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AskAiPanel } from "@/components/ask-ai/AskAiPanel";
import { Confetti } from "@/components/Confetti";
import { MathText } from "@/components/MathText";
import { tap } from "@/lib/haptics";
import { scrollToHighlight } from "@/lib/scrollToHighlight";
import { useAiEnabled } from "@/lib/useAiEnabled";

interface ResultEntry {
  index: number;
  type: QuizQuestion["type"];
  correct: boolean;
  verdict?: "correct" | "partial" | "incorrect";
  feedback: string;
  explanation: string;
  correctAnswer: string;
}

function QuestionCard({
  itemId,
  index,
  question: q,
  answer,
  result,
  disabled,
  onAnswerChange,
}: {
  itemId: number;
  index: number;
  question: QuizQuestion;
  answer: number | string | number[];
  result?: ResultEntry;
  disabled: boolean;
  onAnswerChange: (value: number | string | number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Only ever includes what's currently visible on screen: the question (and
  // options, for MCQ/multi-select) always; the correct answer/explanation
  // only once `result` exists — i.e. only after that's already shown in the
  // Alert below. Never the answer key before the student has seen it.
  function getWholeContext() {
    let text = q.question;
    if (q.type === "mcq" || q.type === "multi_select") {
      text += `\nOptions: ${q.options.join(" | ")}`;
    }
    if (result) {
      text += `\n\nCorrect answer: ${result.correctAnswer}\nExplanation: ${result.explanation}`;
    }
    return text;
  }

  return (
    <Card ref={containerRef}>
      <CardHeader>
        <CardTitle className="text-sm leading-snug font-normal">
          {index + 1}. <MathText text={q.question} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.type === "mcq" ? (
          <RadioGroup
            value={typeof answer === "number" ? String(answer) : ""}
            onValueChange={(v) => onAnswerChange(Number(v))}
            disabled={disabled}
          >
            {q.options.map((option, optIndex) => (
              <Label key={optIndex} className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value={String(optIndex)} />
                <MathText text={option} />
              </Label>
            ))}
          </RadioGroup>
        ) : q.type === "multi_select" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Select all that apply.</p>
            <div className="space-y-2">
              {q.options.map((option, optIndex) => {
                const selected = Array.isArray(answer) ? answer : [];
                const checked = selected.includes(optIndex);
                return (
                  <Label key={optIndex} className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() =>
                        onAnswerChange(
                          checked ? selected.filter((i) => i !== optIndex) : [...selected, optIndex]
                        )
                      }
                    />
                    <MathText text={option} />
                  </Label>
                );
              })}
            </div>
          </div>
        ) : (
          <Textarea
            rows={3}
            disabled={disabled}
            value={String(answer ?? "")}
            onChange={(e) => onAnswerChange(e.target.value)}
          />
        )}

        {result && (
          <Alert
            variant={result.correct ? "default" : result.verdict === "partial" ? "default" : "destructive"}
            className={cn(
              "animate-pop-in animate-pulse-once",
              result.correct
                ? "border-sage/30 bg-sage/5"
                : result.verdict === "partial"
                  ? "border-amber/30 bg-amber/5"
                  : "border-clay/30 bg-clay/5"
            )}
            style={
              {
                "--pulse-color": result.correct
                  ? "color-mix(in oklch, var(--sage) 15%, transparent)"
                  : result.verdict === "partial"
                    ? "color-mix(in oklch, var(--amber) 15%, transparent)"
                    : "color-mix(in oklch, var(--clay) 15%, transparent)",
              } as React.CSSProperties
            }
          >
            {result.correct ? (
              <CheckCircle2 className="text-sage" />
            ) : result.verdict === "partial" ? (
              <CircleAlert className="text-amber" />
            ) : (
              <XCircle className="text-clay" />
            )}
            <AlertTitle>
              {result.correct
                ? "Correct"
                : result.verdict === "partial"
                  ? "Partially correct"
                  : "Incorrect"}
            </AlertTitle>
            <AlertDescription className="space-y-1">
              {q.type === "short_answer" && (
                <p>
                  Model answer: <MathText text={result.correctAnswer} />
                </p>
              )}
              {result.feedback && (
                <p>
                  <MathText text={result.feedback} />
                </p>
              )}
              <p>
                <MathText text={result.explanation} />
              </p>
            </AlertDescription>
          </Alert>
        )}

        <AskAiPanel
          endpoint={`/api/items/${itemId}/ask`}
          containerRef={containerRef}
          getWholeContext={getWholeContext}
          showWholeButtons
        />
      </CardContent>
    </Card>
  );
}

export default function QuizRunner({
  itemId,
  questions,
  onSubmitted,
  highlightQuery,
}: {
  itemId: number;
  questions: QuizQuestion[];
  onSubmitted?: () => void;
  // A search-result snippet to scroll to and flash on first render — see
  // items/[itemId]/page.tsx's `?highlight=`.
  highlightQuery?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [answers, setAnswers] = useState<(number | string | number[])[]>(
    questions.map((q) => (q.type === "multi_select" ? [] : ""))
  );
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<{ score: number; results: ResultEntry[] } | null>(
    null
  );
  const [retrying, setRetrying] = useState(false);
  const aiEnabled = useAiEnabled();

  function setAnswer(index: number, value: number | string | number[]) {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/items/${itemId}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't grade this attempt");
        return;
      }
      setOutcome(body);
      onSubmitted?.();
      tap(body.score === 100 ? [15, 60, 15, 60, 30] : body.score > 0 ? 15 : [15, 80, 15]);
    } catch {
      toast.error("Couldn't grade this attempt");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (highlightQuery && formRef.current) {
      scrollToHighlight(formRef.current, highlightQuery);
    }
    // Runs once against the initial questions render — highlightQuery comes
    // from a static URL param, not something that changes mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missedIndices = outcome?.results.filter((r) => !r.correct).map((r) => r.index) ?? [];

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/items/${itemId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missedIndices }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't generate a retry quiz");
        return;
      }
      router.push(`/items/${body.id}`);
    } catch {
      toast.error("Couldn't generate a retry quiz");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      {outcome && (
        <Alert className="relative animate-pop-in overflow-visible">
          {outcome.score === 100 && <Confetti />}
          <AlertTitle className="flex items-center justify-between gap-3">
            <span>Score: {outcome.score.toFixed(0)}%</span>
            {aiEnabled && missedIndices.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRetry}
                disabled={retrying}
              >
                {retrying ? "Generating…" : `Retry what you got wrong (${missedIndices.length})`}
              </Button>
            )}
          </AlertTitle>
        </Alert>
      )}

      {questions.map((q, index) => (
        <QuestionCard
          key={index}
          itemId={itemId}
          index={index}
          question={q}
          answer={answers[index]}
          result={outcome?.results.find((r) => r.index === index)}
          disabled={!!outcome}
          onAnswerChange={(value) => setAnswer(index, value)}
        />
      ))}

      {!outcome && (
        <Button type="submit" disabled={submitting}>
          {submitting ? "Grading…" : "Submit quiz"}
        </Button>
      )}
    </form>
  );
}
