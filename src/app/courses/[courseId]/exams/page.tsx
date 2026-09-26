"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { FileSearch, GraduationCap, LoaderCircle, Play, Trash2 } from "lucide-react";
import type { StoredExamProfile, MockExamSummary } from "@/lib/exams/store";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { SKILL_CHECK_MINUTES } from "@/lib/exams/topicProfile";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface ExamPrep {
  course: { id: number; name: string };
  profile: StoredExamProfile | null;
  exams: MockExamSummary[];
  documents: { id: number; filename: string; suggested: boolean }[];
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (!res?.ok) toast.error(data?.error ?? "Something went wrong");
  return res?.ok ? data : null;
}

function formatPoints(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function PastExamPicker({
  courseId,
  documents,
  analysed,
  onDone,
}: {
  courseId: number;
  documents: ExamPrep["documents"];
  analysed: boolean;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(documents.filter((d) => d.suggested).map((d) => d.id)));
  const [busy, setBusy] = useState(false);

  async function analyse() {
    setBusy(true);
    const ok = await postJson(`/api/courses/${courseId}/exams/analyze`, { documentIds: [...picked] });
    setBusy(false);
    if (ok) {
      toast.success("Past exams analysed");
      onDone();
    }
  }

  if (documents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        If the course has past exams, upload them as documents to have mock exams match them.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pick the past exams (and solution sheets, if you have them). Likely ones are ticked already; up to six
        are read, full exams first.
      </p>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {documents.map((d) => (
          <li key={d.id}>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox
                checked={picked.has(d.id)}
                onCheckedChange={(v) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (v) next.add(d.id);
                    else next.delete(d.id);
                    return next;
                  })
                }
              />
              <span className="truncate">{d.filename}</span>
            </Label>
          </li>
        ))}
      </ul>
      <Explain id="exams.analyse">
      <Button onClick={() => void analyse()} disabled={busy || picked.size === 0}>
        {busy ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <FileSearch className="size-4" />}
        {busy ? "Analysing…" : analysed ? "Analyse again" : `Analyse ${picked.size} past exam${picked.size === 1 ? "" : "s"}`}
      </Button>
      </Explain>
    </div>
  );
}

export default function ExamPrepPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const { data, error, mutate } = useSWR<ExamPrep>(`/api/courses/${courseId}/exams`);
  const [repicking, setRepicking] = useState(false);
  const [duration, setDuration] = useState("");
  const [generating, setGenerating] = useState(false);

  if (error) return <p className="text-sm text-destructive">Couldn&apos;t load exam prep.</p>;
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  const { profile } = data;
  const minutes = duration ? Number(duration) : (profile?.profile.durationMinutes ?? SKILL_CHECK_MINUTES);

  async function generate() {
    setGenerating(true);
    const res = await postJson(`/api/courses/${courseId}/exams`, { durationMinutes: minutes });
    setGenerating(false);
    if (res) {
      toast.success(`${res.exam.title} is ready`);
      void mutate();
    }
  }

  async function start(examId: number) {
    const res = await postJson(`/api/mock-exams/${examId}/attempts`, {});
    if (res) router.push(`/courses/${courseId}/exams/attempts/${res.attempt.id}`);
  }

  async function discard(attemptId: number) {
    const res = await fetch(`/api/mock-exam-attempts/${attemptId}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't discard that attempt");
    void mutate();
  }

  async function remove(exam: MockExamSummary) {
    const res = await fetch(`/api/mock-exams/${exam.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't delete that exam");
    void mutate();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/courses/${courseId}`} />}>{data.course.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Exam prep</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <GraduationCap className="size-6 text-focus" />
          Exam prep
        </h1>
        <p className="text-sm text-muted-foreground">
          Timed practice tests, graded against a rubric with partial credit. With past exams analysed, they match
          their style, task mix and weighting; without, you get a skill check of your course&apos;s topics. Type
          your answers or photograph handwritten work.
        </p>
      </div>

      {!aiEnabled && (
        <Alert>
          <AlertDescription>Exam prep needs AI — turn it on in Settings.</AlertDescription>
        </Alert>
      )}

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-3 py-4">
          <h2 className="font-heading text-base font-semibold">
            Past exams <span className="text-sm font-normal text-muted-foreground">(optional)</span>
          </h2>
          {profile && !repicking ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {profile.profile.examCount} exam{profile.profile.examCount === 1 ? "" : "s"} analysed ·{" "}
                {profile.profile.durationMinutes} min · {formatPoints(profile.profile.totalPoints)} points ·{" "}
                {profile.profile.language}
              </p>
              {profile.profile.style && <p>{profile.profile.style}</p>}
              <ul className="space-y-1.5">
                {profile.profile.topics.map((t) => (
                  <li key={t.concept} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1">
                    <span className="truncate">{t.concept}</span>
                    <span className="text-right text-xs text-muted-foreground tabular-nums">
                      {Math.round(t.share * 100)}%
                    </span>
                    <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-focus" style={{ width: `${Math.round(t.share * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" onClick={() => setRepicking(true)}>
                Change past exams
              </Button>
            </div>
          ) : (
            <PastExamPicker
              courseId={Number(courseId)}
              documents={data.documents}
              analysed={!!profile}
              onDone={() => {
                setRepicking(false);
                void mutate();
              }}
            />
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-base font-semibold">{profile ? "Mock exams" : "Skill checks"}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="exam-minutes" className="text-xs text-muted-foreground">
                Minutes
              </Label>
              <Explain id="exams.minutes">
              <Input
                id="exam-minutes"
                type="number"
                min={10}
                max={600}
                step={15}
                value={duration || String(profile?.profile.durationMinutes ?? SKILL_CHECK_MINUTES)}
                onChange={(e) => setDuration(e.target.value)}
                className="h-8 w-24"
              />
              </Explain>
            </div>
            <Explain id="exams.write">
            <Button
              onClick={() => void generate()}
              disabled={generating || !aiEnabled || !(minutes >= 10 && minutes <= 600)}
            >
              {generating && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
              {generating ? "Writing the test…" : profile ? "Write a mock exam" : "Write a skill check"}
            </Button>
            </Explain>
          </div>
        </div>
        {generating && (
          <p className="text-xs text-muted-foreground">This takes a minute or two — tasks, rubrics and solutions.</p>
        )}
        {data.exams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {profile
              ? "No mock exams yet."
              : "None yet. A skill check tests your study plan's chapters, or the concepts you've practised, or your material."}
          </p>
        ) : (
          <ul className="space-y-2">
            {data.exams.map((exam) => {
              const graded = exam.attempts.filter((a) => a.status === "graded" && a.score !== null);
              const best = graded.length ? Math.max(...graded.map((a) => a.score as number)) : null;
              const open = exam.attempts.find((a) => a.status !== "graded");
              return (
                <li key={exam.id}>
                  <Card elevation="flat" className="py-0">
                    <CardContent className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{exam.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {exam.taskCount} tasks · {exam.duration_minutes} min · {formatPoints(exam.total_points)}{" "}
                          points
                          {best !== null &&
                            ` · best ${formatPoints(best)}/${formatPoints(exam.total_points)} (${Math.round((best / exam.total_points) * 100)}%)`}
                        </p>
                        {graded.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {graded.map((a) => (
                              <Link key={a.id} href={`/courses/${courseId}/exams/attempts/${a.id}`}>
                                <Badge variant="outline" className="hover:bg-muted">
                                  {formatPoints(a.score as number)} pts · {a.started_at.slice(0, 10)}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                      {open ? (
                        <>
                          {open.status !== "grading" && (
                            <Explain id="exams.discard">
                              <Button size="sm" variant="ghost" onClick={() => void discard(open.id)}>
                                Discard attempt
                              </Button>
                            </Explain>
                          )}
                          <Button
                            size="sm"
                            nativeButton={false}
                            render={<Link href={`/courses/${courseId}/exams/attempts/${open.id}`} />}
                          >
                            {open.status === "in_progress" ? "Continue" : open.status === "grading" ? "Grading…" : "See status"}
                          </Button>
                        </>
                      ) : (
                        <Explain id="exams.start">
                          <Button size="sm" onClick={() => void start(exam.id)}>
                            <Play className="size-3.5" />
                            {graded.length ? "Take again" : "Start"}
                          </Button>
                        </Explain>
                      )}
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${exam.title}`} onClick={() => void remove(exam)}>
                        <Trash2 />
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
