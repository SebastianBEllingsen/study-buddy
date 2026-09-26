"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { CheckCircle2, Circle, Eye, Lightbulb, LoaderCircle, Play, RotateCcw, XCircle } from "lucide-react";
import { cn } from "cn";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";
import { CODE_LANGUAGE_NAMES, type CodeExercise, type CodeProgress, type CodeSet, type RunResult } from "@/lib/code/types";
import { brokenTestNames, pythonLoaded, runTests, withoutBroken } from "@/lib/code/runner";
import { Explain } from "@/components/Explain";
import { CodeEditor } from "@/components/code/CodeEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const SAVE_DELAY_MS = 1000;

function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]}>
        {normalizeLatexDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}

async function act(setId: number, body: Record<string, unknown>): Promise<CodeSet | null> {
  const res = await fetch(`/api/code-sets/${setId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) {
    toast.error(data?.error ?? "Couldn't save that");
    return null;
  }
  return data.set as CodeSet;
}

function Exercise({
  set,
  index,
  exercise,
  progress,
  broken,
  onSet,
  onNext,
}: {
  set: CodeSet;
  index: number;
  exercise: CodeExercise;
  progress: CodeProgress;
  // Names of tests the reference solution fails, once checked.
  broken: Map<number, Set<string>>;
  onSet: (set: CodeSet) => void;
  onNext: (() => void) | null;
}) {
  const [code, setCode] = useState(progress.code);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState<null | "loading" | "running">(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipped = broken.get(index);
  const visibleTests = exercise.tests.filter((t) => !t.hidden);
  const hiddenCount = exercise.tests.length - visibleTests.length;

  function change(value: string) {
    setCode(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void act(set.id, { action: "save", exercise: index, code: value }), SAVE_DELAY_MS);
  }

  async function run() {
    if (running) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setRunning(set.language === "python" && !pythonLoaded() ? "loading" : "running");
    // First, check the tests against the reference solution: any it fails
    // are the AI's mistakes, not the learner's.
    let bad = broken.get(index);
    if (!bad) {
      bad = brokenTestNames(await runTests(set.language, exercise.solution, exercise.tests));
      broken.set(index, bad);
    }
    setRunning("running");
    const raw = await runTests(set.language, code, exercise.tests);
    const run = { ...raw, tests: withoutBroken(raw.tests, bad) };
    setResult(run);
    setRunning(null);
    const next = await act(set.id, { action: "run", exercise: index, code, error: run.error, tests: run.tests });
    if (next) {
      if (next.progress[index].passed && !progress.passed) toast.success("All tests pass");
      onSet(next);
    }
  }

  async function hint() {
    const next = await act(set.id, { action: "hint", exercise: index });
    if (next) onSet(next);
  }

  async function reveal() {
    setConfirmReveal(false);
    const next = await act(set.id, { action: "reveal", exercise: index });
    if (next) onSet(next);
  }

  const failing = result?.tests.filter((t) => !t.passed).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-heading text-lg font-semibold">
          {index + 1}. {exercise.title}
        </h2>
        <Markdown text={exercise.prompt} />
      </div>

      {(visibleTests.length > 0 || hiddenCount > 0) && (
        <details className="rounded-md border px-3 py-2 text-sm" open={progress.done}>
          <summary className="cursor-pointer text-muted-foreground">
            Tests: {visibleTests.length} shown{hiddenCount > 0 && !progress.done ? `, ${hiddenCount} hidden until you finish` : ""}
          </summary>
          <ul className="mt-2 space-y-2">
            {(progress.done ? exercise.tests : visibleTests).map((t) => (
              <li key={t.name}>
                <p className="text-xs font-medium">{t.name}</p>
                <pre className="mt-0.5 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{t.code}</pre>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void run();
          }
        }}
      >
        <CodeEditor language={set.language} value={code} onChange={change} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Explain id="code.run">
          <Button onClick={() => void run()} disabled={running !== null}>
            {running ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Play className="size-4" />}
            {running === "loading" ? "Loading Python…" : running ? "Running…" : "Run tests"}
          </Button>
        </Explain>
        {progress.hintsUsed < exercise.hints.length && !progress.done && (
          <Explain id="code.hint">
            <Button variant="outline" onClick={() => void hint()}>
              <Lightbulb className="size-4" />
              Hint
            </Button>
          </Explain>
        )}
        {!progress.revealed && (
          <Explain id="code.reveal">
            <Button
              variant="ghost"
              className={confirmReveal ? "text-destructive" : undefined}
              onClick={() => (confirmReveal || progress.done ? void reveal() : setConfirmReveal(true))}
              onBlur={() => setConfirmReveal(false)}
            >
              <Eye className="size-4" />
              {progress.done ? "Compare with the solution" : confirmReveal ? "Click again to give up and see it" : "Show solution"}
            </Button>
          </Explain>
        )}
        <Explain id="code.reset">
          <Button variant="ghost" size="icon-sm" aria-label="Reset to the starter code" onClick={() => change(exercise.starter)}>
            <RotateCcw />
          </Button>
        </Explain>
      </div>
      {running === "loading" && (
        <p className="text-xs text-muted-foreground">The first Python run downloads the interpreter, which takes a moment.</p>
      )}

      {progress.hintsUsed > 0 && (
        <ol className="list-decimal space-y-1 rounded-md bg-amber/10 py-2 pr-3 pl-8 text-sm">
          {exercise.hints.slice(0, progress.hintsUsed).map((h, i) => (
            <li key={i}>
              <Markdown text={h} />
            </li>
          ))}
        </ol>
      )}

      {result && (
        <div className="space-y-2">
          {result.error && (
            <Alert className="border-clay/30 bg-clay/5">
              <XCircle className="text-clay" />
              <AlertTitle>Your code didn&apos;t run</AlertTitle>
              <AlertDescription>
                <pre className="whitespace-pre-wrap text-xs">{result.error}</pre>
              </AlertDescription>
            </Alert>
          )}
          {!result.error && (
            <p className={cn("text-sm font-medium", failing ? "text-clay" : "text-sage")}>
              {failing ? `${failing} of ${result.tests.length} tests failing` : `All ${result.tests.length} tests pass`}
            </p>
          )}
          <ul className="space-y-1">
            {result.tests.map((t) => (
              <li key={t.name} className="flex gap-2 text-sm">
                {t.passed ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sage" aria-label="Passed" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-clay" aria-label="Failed" />
                )}
                <span className="min-w-0">
                  {t.name}
                  {!t.passed && t.message && !result.error && (
                    <span className="block font-mono text-xs break-words text-muted-foreground">{t.message}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!!skipped?.size && (
            <p className="text-xs text-muted-foreground">
              {skipped.size} test{skipped.size === 1 ? " was" : "s were"} skipped: the reference solution fails{" "}
              {skipped.size === 1 ? "it" : "them"} too, so {skipped.size === 1 ? "it's" : "they're"} likely wrong.
            </p>
          )}
          {result.stdout && (
            <div>
              <p className="text-xs text-muted-foreground">Output</p>
              <pre className="max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs">{result.stdout}</pre>
            </div>
          )}
        </div>
      )}

      {progress.done && (
        <Alert className={progress.passed ? "border-sage/30 bg-sage/5" : undefined}>
          {progress.passed ? <CheckCircle2 className="text-sage" /> : <Eye />}
          <AlertTitle>{progress.passed ? "Solved" : "Solution shown"}</AlertTitle>
          <AlertDescription className="space-y-2">
            {progress.revealed && (
              <CodeEditor language={set.language} value={exercise.solution} readOnly minHeight="4rem" />
            )}
            {onNext && (
              <Button size="sm" onClick={onNext}>
                Next exercise
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function CodeSetPage() {
  const { courseId, setId } = useParams<{ courseId: string; setId: string }>();
  const { data, error, mutate } = useSWR<{ set: CodeSet }>(`/api/code-sets/${setId}`, { revalidateOnFocus: false });
  const [picked, setPicked] = useState<number | null>(null);
  // Per exercise: tests the reference solution fails. Kept for the visit.
  const [broken] = useState(() => new Map<number, Set<string>>());

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load these exercises.</p>;
  if (!data) return <Skeleton className="h-96 rounded-xl" />;
  const { set } = data;
  const firstOpen = set.progress.findIndex((p) => !p.done);
  const current = picked ?? (firstOpen === -1 ? 0 : firstOpen);
  const done = set.progress.filter((p) => p.done).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-1">
        <Link href={`/courses/${courseId}/code`} className="text-sm text-muted-foreground hover:underline">
          ← Code exercises
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{set.title}</h1>
        <p className="text-sm text-muted-foreground">
          {CODE_LANGUAGE_NAMES[set.language]} · {done} of {set.exercises.length} done
        </p>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Exercises">
        {set.exercises.map((e, i) => (
          <Button
            key={i}
            size="sm"
            variant={i === current ? "secondary" : "ghost"}
            aria-current={i === current ? "step" : undefined}
            onClick={() => setPicked(i)}
          >
            {set.progress[i].passed ? (
              <CheckCircle2 className="size-3.5 text-sage" />
            ) : set.progress[i].done ? (
              <Eye className="size-3.5 text-muted-foreground" />
            ) : (
              <Circle className="size-3.5 text-muted-foreground" />
            )}
            {i + 1}. {e.title}
          </Button>
        ))}
      </nav>

      <Exercise
        key={`${set.id}:${current}`}
        set={set}
        index={current}
        exercise={set.exercises[current]}
        progress={set.progress[current]}
        broken={broken}
        onSet={(next) => void mutate({ set: next }, { revalidate: false })}
        onNext={current + 1 < set.exercises.length ? () => setPicked(current + 1) : null}
      />
    </div>
  );
}
