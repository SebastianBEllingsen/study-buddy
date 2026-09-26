"use client";

import { Explain } from "@/components/Explain";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Camera, CheckCircle2, CircleAlert, Clock, Lightbulb, LoaderCircle, Pause, Play, X, XCircle } from "lucide-react";
import { cn } from "cn";
import type { MockExamAttempt, TaskAnswer, TaskResult } from "@/lib/exams/types";
import type { PublicTask } from "@/lib/exams/requests";
import { uploadImage, describeUploadError } from "@/lib/uploadImage";
import { examTimeLeftMs } from "@/lib/exams/timing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/MathText";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AttemptResponse {
  attempt: MockExamAttempt;
  exam: { id: number; course_id: number; title: string; duration_minutes: number; total_points: number; tasks: PublicTask[] };
}

const MAX_PHOTOS = 6;
const MAX_PHOTO_SIDE = 2000;

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Phone photos are large; a 2000px JPEG is plenty to read handwriting.
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

function Countdown({ attempt, minutes }: { attempt: MockExamAttempt; minutes: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = examTimeLeftMs(attempt, minutes, now);
  const abs = Math.abs(left);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const text = `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
  return (
    <span className={cn("flex items-center gap-1.5 font-mono tabular-nums", left < 0 ? "text-clay" : left < 300_000 && "text-amber")}>
      <Clock className="size-4" />
      {left < 0 ? `${text} over time` : `${text} left`}
      {attempt.paused_at && " · paused"}
    </span>
  );
}

function AnswerEditor({
  task,
  index,
  answer,
  onChange,
}: {
  task: PublicTask;
  index: number;
  answer: TaskAnswer;
  onChange: (answer: TaskAnswer) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const urls: string[] = [];
    for (const file of [...files].slice(0, MAX_PHOTOS - answer.images.length)) {
      try {
        urls.push(await uploadImage(await shrinkPhoto(file), "answer"));
      } catch (err) {
        toast.error(describeUploadError(err, "Couldn't upload that photo"));
      }
    }
    setUploading(false);
    if (urls.length) onChange({ ...answer, images: [...answer.images, ...urls] });
  }

  return (
    <Card className="gap-3 px-5 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">
          {index + 1}. {task.title}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">{fmt(task.points)} points</span>
      </div>
      <div className="whitespace-pre-line leading-relaxed">
        <MathText text={task.prompt} />
      </div>
      <Textarea
        rows={6}
        placeholder="Your answer — math like $x^2$ works. Or photograph your written work below."
        value={answer.text}
        onChange={(e) => onChange({ ...answer, text: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        {answer.images.map((url, i) => (
          <div key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- user photo, any origin/data URL */}
            <img src={url} alt={`Photo ${i + 1} of your answer`} className="size-20 rounded-md border object-cover" />
            <button
              type="button"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => onChange({ ...answer, images: answer.images.filter((u) => u !== url) })}
              className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {answer.images.length < MAX_PHOTOS && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => {
                void addPhotos(e.target.files);
                e.target.value = "";
              }}
            />
            <Explain id="exams.photo">
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Camera className="size-3.5" />}
              {uploading ? "Uploading…" : "Add photo of handwritten work"}
            </Button>
            </Explain>
          </>
        )}
      </div>
    </Card>
  );
}

function TaskResultCard({ task, index, answer, result }: { task: PublicTask; index: number; answer: TaskAnswer; result: TaskResult }) {
  const ratio = result.maxPoints ? result.points / result.maxPoints : 0;
  const Icon = ratio >= 0.85 ? CheckCircle2 : ratio >= 0.4 ? CircleAlert : XCircle;
  return (
    <Card className="gap-3 px-5 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium">
          <Icon className={cn("size-4", ratio >= 0.85 ? "text-sage" : ratio >= 0.4 ? "text-amber" : "text-clay")} />
          {index + 1}. {task.title}
        </h2>
        <span className="shrink-0 text-sm tabular-nums">
          {fmt(result.points)} / {fmt(result.maxPoints)}
        </span>
      </div>
      <div className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
        <MathText text={task.prompt} />
      </div>
      {result.feedback && <p className="text-sm">{result.feedback}</p>}
      {result.misconception && (
        <p className="flex gap-2 rounded-md bg-focus/10 px-3 py-2 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-focus" />
          <span>{result.misconception}</span>
        </p>
      )}
      <ul className="space-y-1 text-sm">
        {result.criteria.map((c, i) => (
          <li key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
            <span className="tabular-nums text-muted-foreground">
              {fmt(c.awarded)}/{fmt(c.max)}
            </span>
            <span>
              {c.criterion}
              {c.comment && <span className="text-muted-foreground"> — {c.comment}</span>}
            </span>
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Your answer and the model solution</summary>
        <div className="mt-2 space-y-2">
          {answer.text.trim() && (
            <div className="whitespace-pre-line rounded-md bg-muted/50 px-3 py-2">
              <MathText text={answer.text} />
            </div>
          )}
          {result.transcription && (
            <div className="whitespace-pre-line rounded-md bg-muted/50 px-3 py-2">
              <p className="mb-1 text-xs text-muted-foreground">Read from your photos:</p>
              <MathText text={result.transcription} />
            </div>
          )}
          {task.solution && (
            <div className="whitespace-pre-line rounded-md border border-sage/30 bg-sage/5 px-3 py-2">
              <MathText text={task.solution} />
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

export default function AttemptPage() {
  const { courseId, attemptId } = useParams<{ courseId: string; attemptId: string }>();
  const router = useRouter();
  const key = `/api/mock-exam-attempts/${attemptId}`;
  const { data, error, mutate } = useSWR<AttemptResponse>(key, {
    refreshInterval: (latest) => (latest?.attempt.status === "grading" ? 3000 : 0),
    revalidateOnFocus: false,
  });
  const [answers, setAnswers] = useState<TaskAnswer[] | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (data && seeded !== data.attempt.id) {
    setSeeded(data.attempt.id);
    setAnswers(data.attempt.answers);
  }

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  function change(index: number, answer: TaskAnswer) {
    if (!answers) return;
    const next = answers.map((a, i) => (i === index ? answer : a));
    setAnswers(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const res = await fetch(key, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: next }),
      }).catch(() => null);
      setSaving(false);
      if (!res?.ok) toast.error("Couldn't save your answers — they're still on this page");
    }, 1500);
  }

  async function setPaused(paused: boolean) {
    const res = await fetch(`${key}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused }),
    }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't pause the exam");
    void mutate();
  }

  async function discard() {
    const res = await fetch(key, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      toast.error("Couldn't discard this attempt");
      return;
    }
    router.push(`/courses/${courseId}/exams`);
  }

  async function submit() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSubmitting(true);
    const res = await fetch(`${key}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data?.attempt.status === "in_progress" ? { answers } : {}),
    }).catch(() => null);
    setSubmitting(false);
    setConfirmOpen(false);
    if (!res?.ok) {
      toast.error((await res?.json().catch(() => ({})))?.error ?? "Couldn't hand in the exam");
      return;
    }
    void mutate();
  }

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load this exam.</p>;
  if (!data || !answers) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  const { attempt, exam } = data;
  const backHref = `/courses/${courseId}/exams`;

  if (attempt.status === "graded" && attempt.results) {
    const score = attempt.score ?? 0;
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2">
          <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
            ← Exam prep
          </Link>
          <h1 className="font-heading text-2xl font-semibold">{exam.title}</h1>
          <p className="text-3xl font-semibold tabular-nums">
            {fmt(score)} / {fmt(exam.total_points)}{" "}
            <span className="text-lg text-muted-foreground">({Math.round((score / exam.total_points) * 100)}%)</span>
          </p>
          <p className="text-sm text-muted-foreground">
            Every task is now in your spaced review, and the ones you lost points on are in your mistake log.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" nativeButton={false} render={<Link href={`/review?mode=mistakes&courseId=${courseId}`} />}>
              Redo your mistakes
            </Button>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/courses/${courseId}/knowledge`} />}>
              Concepts
            </Button>
          </div>
        </div>
        {exam.tasks.map((task, i) => (
          <TaskResultCard key={i} task={task} index={i} answer={attempt.answers[i]} result={attempt.results![i]} />
        ))}
      </div>
    );
  }

  if (attempt.status === "grading" || attempt.status === "failed") {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
          ← Exam prep
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{exam.title}</h1>
        {attempt.status === "grading" ? (
          <Card className="items-center gap-3 py-12 text-center">
            <LoaderCircle className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
            <p className="font-medium">Grading your answers…</p>
            <p className="text-sm text-muted-foreground">Task by task against each rubric. This takes a minute or two.</p>
          </Card>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Grading didn&apos;t finish</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{attempt.error_message ?? "Something went wrong."} Your answers are saved.</p>
              <Button size="sm" variant="outline" disabled={submitting} onClick={() => void submit()}>
                Try grading again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const answered = answers.filter((a) => a.text.trim() || a.images.length).length;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate font-heading text-lg font-semibold">{exam.title}</h1>
          <p className="text-xs text-muted-foreground">
            {answered} of {exam.tasks.length} answered · {fmt(exam.total_points)} points
            {saving && " · saving…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Countdown attempt={attempt} minutes={exam.duration_minutes} />
          <Explain id="exams.pause" side="bottom">
          <Button size="sm" variant="outline" onClick={() => void setPaused(!attempt.paused_at)}>
            {attempt.paused_at ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {attempt.paused_at ? "Resume" : "Pause"}
          </Button>
          </Explain>
          <Explain id="exams.handIn" side="bottom">
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={!!attempt.paused_at}>
              Hand in
            </Button>
          </Explain>
        </div>
      </div>

      {attempt.paused_at ? (
        <Card className="items-center gap-3 py-12 text-center">
          <Pause className="size-8 text-muted-foreground" />
          <p className="font-medium">Paused — the clock is stopped.</p>
          <p className="text-sm text-muted-foreground">The tasks are hidden until you resume. Your answers are saved.</p>
          <div className="flex gap-2">
            <Button onClick={() => void setPaused(false)}>
              <Play className="size-4" />
              Resume
            </Button>
            <Button variant="ghost" onClick={() => void discard()}>
              Discard this attempt
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {exam.tasks.map((task, i) => (
            <AnswerEditor key={i} task={task} index={i} answer={answers[i]} onChange={(a) => change(i, a)} />
          ))}
          <div className="flex justify-end">
            <Button onClick={() => setConfirmOpen(true)}>Hand in for grading</Button>
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hand in the exam?</AlertDialogTitle>
            <AlertDialogDescription>
              {answered < exam.tasks.length
                ? `${exam.tasks.length - answered} task${exam.tasks.length - answered === 1 ? " is" : "s are"} still blank. `
                : ""}
              You can&apos;t change your answers after this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={() => void submit()}>
              {submitting ? "Handing in…" : "Hand in"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
