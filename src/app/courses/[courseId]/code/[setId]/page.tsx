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
import { CheckCircle2, Circle, Eye, Lightbulb, LoaderCircle, MessageSquareText, Play, RotateCcw, XCircle } from "lucide-react";
import { cn } from "cn";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";
import {
  CODE_LANGUAGE_NAMES,
  EXERCISE_KIND_LABELS,
  isRunKind,
  type CodeExercise,
  type CodeProgress,
  type CodeReview,
  type CodeSet,
  type ProjectFile,
  type RunResult,
} from "@/lib/code/types";
import { brokenTestNames, pythonLoaded, runTests, withoutBroken } from "@/lib/code/runner";
import { Explain } from "@/components/Explain";
import { CodeEditor } from "@/components/code/CodeEditor";
import { ProjectEditor } from "@/components/code/ProjectEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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

function RunExercise({
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
  const isProject = exercise.kind === "project";
  const [code, setCode] = useState(progress.code);
  // A project milestone is several files, not one text.
  const [files, setFiles] = useState<ProjectFile[]>(progress.files);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState<null | "loading" | "running">(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipped = broken.get(index);
  const visibleTests = exercise.tests.filter((t) => !t.hidden);
  const hiddenCount = exercise.tests.length - visibleTests.length;

  function change(value: string) {
    setCode(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void act(set.id, { action: "save", exercise: index, code: value }), SAVE_DELAY_MS);
  }

  function changeFiles(next: ProjectFile[]) {
    setFiles(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void act(set.id, { action: "save", exercise: index, code: "", files: next }), SAVE_DELAY_MS);
  }

  async function run() {
    if (running) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setRunning(set.language === "python" && !pythonLoaded() ? "loading" : "running");
    // First, check the tests against the reference solution: any it fails
    // are the AI's mistakes, not the learner's.
    let bad = broken.get(index);
    if (!bad) {
      bad = brokenTestNames(
        isProject
          ? await runTests(set.language, "", exercise.tests, exercise.setup, exercise.solutionFiles)
          : await runTests(set.language, exercise.solution, exercise.tests, exercise.setup)
      );
      broken.set(index, bad);
    }
    setRunning("running");
    const raw = isProject ? await runTests(set.language, "", exercise.tests, exercise.setup, files) : await runTests(set.language, code, exercise.tests, exercise.setup);
    const run = { ...raw, tests: withoutBroken(raw.tests, bad) };
    setResult(run);
    setRunning(null);
    const next = await act(set.id, { action: "run", exercise: index, code: isProject ? "" : code, ...(isProject && { files }), error: run.error, tests: run.tests });
    if (next) {
      if (next.progress[index].passed && !progress.passed) toast.success("All tests pass");
      onSet(next);
    }
  }

  async function hint() {
    const next = await act(set.id, { action: "hint", exercise: index });
    if (next) onSet(next);
  }

  async function askReview() {
    setReviewing(true);
    const next = await act(set.id, { action: "review", exercise: index });
    setReviewing(false);
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
        <ExerciseTitle index={index} exercise={exercise} />
        <Markdown text={exercise.prompt} />
      </div>

      <SetupBlock language={set.language} setup={exercise.setup} />

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
        {isProject ? (
          <ProjectEditor language={set.language} files={files} onChange={changeFiles} keep={exercise.files.map((f) => f.name)} />
        ) : (
          <CodeEditor language={set.language} value={code} onChange={change} />
        )}
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
          <Button variant="ghost" size="icon-sm" aria-label="Reset to the starter code" onClick={() => (isProject ? changeFiles(exercise.files) : change(exercise.starter))}>
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
          {!!result.images?.length && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{result.images.length === 1 ? "Plot" : "Plots"}</p>
              <div className="flex flex-wrap gap-2">
                {result.images.map((src, i) => (
                  // A figure from the learner's own code, as a data URL — next/image has nothing to optimise.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`Plot ${i + 1} drawn by your code`} className="max-h-80 max-w-full rounded border bg-white" />
                ))}
              </div>
            </div>
          )}
          {result.diagnostics && (
            <div>
              <p className="text-xs text-muted-foreground">Compiler warnings in your code</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-xs">{result.diagnostics}</pre>
            </div>
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
            {progress.revealed &&
              (isProject ? (
                <ProjectEditor language={set.language} files={exercise.solutionFiles} readOnly />
              ) : (
                <CodeEditor language={set.language} value={exercise.solution} readOnly minHeight="4rem" />
              ))}
            {onNext && (
              <Button size="sm" onClick={onNext}>
                Next exercise
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {progress.passed && (
        <ReviewPanel
          review={progress.review}
          busy={reviewing}
          onAsk={() => void askReview()}
        />
      )}
    </div>
  );
}

const VERDICT_STYLE: Record<CodeReview["verdict"], { label: string; className: string }> = {
  great: { label: "Great", className: "text-sage" },
  good: { label: "Good, with improvements", className: "text-foreground" },
  needs_work: { label: "Passes, but needs work", className: "text-clay" },
};

// What the tests can't tell you: an AI review of working code.
function ReviewPanel({ review, busy, onAsk }: { review: CodeReview | null; busy: boolean; onAsk: () => void }) {
  if (!review) {
    return (
      <div className="space-y-1">
        <Explain id="code.review">
          <Button variant="outline" onClick={onAsk} disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <MessageSquareText className="size-4" />}
            {busy ? "Reviewing…" : "Review my solution"}
          </Button>
        </Explain>
        <p className="text-xs text-muted-foreground">
          Passing the tests isn&apos;t the same as good code. Get a code review: edge cases, clarity, and how a senior
          engineer would improve it.
        </p>
      </div>
    );
  }
  const verdict = VERDICT_STYLE[review.verdict];
  return (
    <section className="space-y-2 rounded-md border px-3 py-3 text-sm" aria-label="Code review">
      <p className={cn("font-medium", verdict.className)}>Code review: {verdict.label}</p>
      <p>{review.summary}</p>
      {review.points.length > 0 && (
        <ul className="space-y-2">
          {review.points.map((p, i) => (
            <li key={i} className="flex gap-2">
              <Badge variant="outline" className="mt-0.5 h-fit shrink-0">
                {p.kind}
              </Badge>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      )}
      {review.verdict === "needs_work" && (
        <p className="text-xs text-muted-foreground">Added to your mistakes, so it comes back until you&apos;ve fixed it.</p>
      )}
    </section>
  );
}

// SQL exercises: the tables and rows the query runs on.
function SetupBlock({ language, setup }: { language: CodeSet["language"]; setup: string }) {
  if (!setup) return null;
  return (
    <details className="rounded-md border px-3 py-2 text-sm" open>
      <summary className="cursor-pointer text-muted-foreground">The database this runs on</summary>
      <div className="mt-2">
        <CodeEditor language={language} value={setup} readOnly minHeight="3rem" />
      </div>
    </details>
  );
}

function ExerciseTitle({ index, exercise }: { index: number; exercise: CodeExercise }) {
  return (
    <h2 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold">
      <span>
        {index + 1}. {exercise.title}
      </span>
      {exercise.kind !== "write" && <Badge variant="secondary">{EXERCISE_KIND_LABELS[exercise.kind]}</Badge>}
    </h2>
  );
}

// "Predict the output" and "Read the code": the code is shown, not run
// against tests, and the learner answers in words. Predict is checked
// against the exact output; read is compared with a model answer by the
// learner, who says how they did.
function AnswerExercise({
  set,
  index,
  exercise,
  progress,
  onSet,
  onNext,
}: {
  set: CodeSet;
  index: number;
  exercise: CodeExercise;
  progress: CodeProgress;
  onSet: (set: CodeSet) => void;
  onNext: (() => void) | null;
}) {
  const [answer, setAnswer] = useState(progress.answer);
  const [compared, setCompared] = useState(progress.done);
  const [busy, setBusy] = useState(false);
  const [actual, setActual] = useState<RunResult | null>(null);
  const [wrong, setWrong] = useState(false);
  const predict = exercise.kind === "predict";

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    const next = await act(set.id, { exercise: index, ...body });
    setBusy(false);
    if (next) onSet(next);
    return next;
  }

  async function check() {
    const next = await send({ action: "answer", answer });
    const now = next?.progress[index];
    setWrong(!!now && !now.passed);
    if (now?.passed) toast.success("Exactly right");
  }

  async function runIt() {
    setBusy(true);
    setActual(await runTests(set.language, exercise.starter, [], exercise.setup));
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ExerciseTitle index={index} exercise={exercise} />
        <Markdown text={exercise.prompt} />
      </div>

      <SetupBlock language={set.language} setup={exercise.setup} />
      <CodeEditor language={set.language} value={exercise.starter} readOnly minHeight="6rem" />

      <div className="space-y-1.5">
        <label htmlFor={`answer-${index}`} className="text-sm font-medium">
          {predict ? "What does it print?" : "Your answer"}
        </label>
        <Textarea
          id={`answer-${index}`}
          value={answer}
          disabled={progress.done}
          rows={predict ? 3 : 4}
          className={predict ? "font-mono text-sm" : undefined}
          placeholder={predict ? "Exactly what appears on screen" : "In your own words"}
          onChange={(e) => {
            setAnswer(e.target.value);
            setWrong(false);
          }}
        />
      </div>

      {!progress.done && (
        <div className="flex flex-wrap items-center gap-2">
          {predict ? (
            <Button onClick={() => void check()} disabled={busy || !answer.trim()}>
              {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Play className="size-4" />}
              Check answer
            </Button>
          ) : (
            !compared && (
              <Button onClick={() => setCompared(true)} disabled={!answer.trim()}>
                Compare with the model answer
              </Button>
            )
          )}
          {progress.hintsUsed < exercise.hints.length && (
            <Button variant="outline" onClick={() => void send({ action: "hint" })} disabled={busy}>
              <Lightbulb className="size-4" />
              Hint
            </Button>
          )}
          {predict && (
            <Button variant="ghost" onClick={() => void send({ action: "reveal" })} disabled={busy}>
              <Eye className="size-4" />
              Show the answer
            </Button>
          )}
        </div>
      )}

      {wrong && !progress.done && <p className="text-sm text-clay">Not quite — read it again, line by line. Try once more.</p>}

      {progress.hintsUsed > 0 && (
        <ol className="list-decimal space-y-1 rounded-md bg-amber/10 py-2 pr-3 pl-8 text-sm">
          {exercise.hints.slice(0, progress.hintsUsed).map((h, i) => (
            <li key={i}>
              <Markdown text={h} />
            </li>
          ))}
        </ol>
      )}

      {!predict && compared && (
        <Alert>
          <Eye />
          <AlertTitle>Model answer</AlertTitle>
          <AlertDescription className="space-y-3">
            <Markdown text={exercise.answer} />
            {!progress.done && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Did your answer cover it?</span>
                <Button size="sm" disabled={busy} onClick={() => void send({ action: "answer", answer, selfCorrect: true })}>
                  Yes
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void send({ action: "answer", answer, selfCorrect: false })}>
                  Not really
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {predict && (progress.done || actual) && (
        <div className="space-y-2">
          {progress.done && (
            <Alert className={progress.passed ? "border-sage/30 bg-sage/5" : undefined}>
              {progress.passed ? <CheckCircle2 className="text-sage" /> : <Eye />}
              <AlertTitle>{progress.passed ? "Right" : "Answer shown"}</AlertTitle>
              <AlertDescription>
                <pre className="whitespace-pre-wrap text-xs">{exercise.answer}</pre>
              </AlertDescription>
            </Alert>
          )}
          {actual && (
            <div>
              <p className="text-xs text-muted-foreground">Output when run</p>
              <pre className="max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                {actual.error ?? (actual.stdout || "(nothing printed)")}
              </pre>
            </div>
          )}
        </div>
      )}
      {predict && progress.done && !actual && (
        <Button variant="outline" size="sm" onClick={() => void runIt()} disabled={busy}>
          <Play className="size-4" />
          Run it and see
        </Button>
      )}

      {progress.done && onNext && (
        <Button size="sm" onClick={onNext}>
          Next exercise
        </Button>
      )}
    </div>
  );
}

function Exercise(props: React.ComponentProps<typeof RunExercise>) {
  return isRunKind(props.exercise.kind) ? <RunExercise {...props} /> : <AnswerExercise {...props} />;
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
