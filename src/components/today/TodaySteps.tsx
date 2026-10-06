"use client";

import { Explain } from "@/components/Explain";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlarmClock, ArrowRight, Check, CheckCheck, ExternalLink, SkipForward } from "lucide-react";
import { cn } from "cn";
import type { TodayStep } from "@/lib/today/planDay";
import {
  currentStep,
  finishedPlanSessions,
  markDoneForToday,
  sessionFocusMs,
  sessionProgress,
  setStepStatus,
  snoozeStep,
  type SessionStep,
  type TodaySession,
} from "@/lib/today/session";
import { useAiEnabled } from "@/lib/useAiEnabled";
import { Button } from "@/components/ui/button";
import { usePomodoro } from "@/components/pomodoro/PomodoroProvider";
import { recordFinishedSession, saveTodaySession, updateTodaySession } from "./todayStore";

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Opens a step: an external resource in a new tab, anything else in place.
// A "test yourself" step with no quiz yet makes one first (when AI is on),
// falling back to the chapter's plan page if that fails.
export function useOpenStep() {
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  return (step: Pick<TodayStep, "href" | "external" | "generateQuiz">) => {
    if (step.external) {
      window.open(step.href, "_blank", "noopener,noreferrer");
      return;
    }
    const { generateQuiz } = step;
    if (!generateQuiz || !aiEnabled) {
      router.push(step.href);
      return;
    }
    void (async () => {
      const toastId = toast.loading("Making your quiz…");
      try {
        const res = await fetch(`/api/study-plans/${generateQuiz.planId}/chapters/${generateQuiz.chapterId}/generate/quiz`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const item = await res.json().catch(() => ({}));
        if (res.ok && typeof item.id === "number") {
          toast.dismiss(toastId);
          router.push(`/items/${item.id}`);
          return;
        }
        toast.error(item.error ?? "Couldn't make the quiz", { id: toastId });
      } catch {
        toast.error("Couldn't make the quiz", { id: toastId });
      }
      router.push(step.href);
    })();
  };
}

// "Done": records it in the study plan where there's something to record,
// then moves on.
export async function completeTodayStep(step: SessionStep): Promise<boolean> {
  if (step.completion && !(await post("/api/today/complete", step.completion))) {
    toast.error("Couldn't save that step");
    return false;
  }
  updateTodaySession((s) => setStepStatus(s, step.id, "done"));
  return true;
}

// "Done for today": today's share of a plan resource (say, a few videos of a
// long playlist) is done, but the resource stays open in the plan and comes
// back tomorrow.
export function doneForToday(step: SessionStep) {
  updateTodaySession((s) => markDoneForToday(s, step.id));
}

// Focus time of the running session, live while the timer runs.
export function useSessionFocusMs(session: TodaySession): number {
  const { state, now } = usePomodoro();
  return sessionFocusMs(session, state, now);
}

export function formatFocus(ms: number): string {
  return `${Math.floor(ms / 60_000)} min`;
}

// Finishing the day marks the plan sessions whose work got done.
export async function finishTodaySession(session: TodaySession, focusMs: number) {
  for (const s of finishedPlanSessions(session, focusMs)) {
    await post("/api/today/complete", { type: "session", ...s });
  }
  recordFinishedSession(session, focusMs);
  saveTodaySession(null);
}

export function StepActions({ step, compact }: { step: SessionStep; compact?: boolean }) {
  const open = useOpenStep();
  const size = compact ? "icon-xs" : "icon-sm";
  // A plan resource can be bigger than today's slot (a 16-video playlist), so
  // it gets two kinds of done; everything else has just one.
  const isResource = step.completion?.type === "resource";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Explain id="today.go">
        <Button size={compact ? "xs" : "sm"} variant="outline" onClick={() => open(step)}>
          {step.external ? <ExternalLink className="size-3.5" /> : <ArrowRight className="size-3.5" />}
          Go
        </Button>
      </Explain>
      {isResource && (
        <Explain id="today.partial">
          <Button size={size} variant="ghost" aria-label="Done for today" onClick={() => doneForToday(step)}>
            <Check />
          </Button>
        </Explain>
      )}
      <Explain id={isResource ? "today.finished" : "today.done"}>
        <Button
          size={size}
          variant="ghost"
          aria-label={isResource ? "Finished it all" : "Done"}
          onClick={() => void completeTodayStep(step)}
        >
          {isResource ? <CheckCheck /> : <Check />}
        </Button>
      </Explain>
      <Explain id="today.later">
        <Button size={size} variant="ghost" aria-label="Later today" onClick={() => updateTodaySession((s) => snoozeStep(s, step.id))}>
          <AlarmClock />
        </Button>
      </Explain>
      <Explain id="today.skip">
        <Button
          size={size}
          variant="ghost"
          aria-label="Skip"
          onClick={() => updateTodaySession((s) => setStepStatus(s, step.id, "skipped"))}
        >
          <SkipForward />
        </Button>
      </Explain>
    </div>
  );
}

export function StepLine({
  step,
  current,
}: {
  step: TodayStep & { status?: SessionStep["status"]; partial?: boolean };
  current?: boolean;
}) {
  const status = step.status ?? "pending";
  return (
    <div className={cn("min-w-0 flex-1", status !== "pending" && "text-muted-foreground")}>
      <p className={cn("truncate text-sm", current && "font-medium", status === "skipped" && "line-through")}>
        {status === "done" && <Check className="mr-1 inline size-3.5 text-sage" />}
        {step.title}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {step.minutes} min
        {step.courseName && ` · ${step.courseName}`}
        {step.detail && ` · ${step.detail}`}
        {step.partial && " · done for today, still open in your plan"}
      </p>
      {step.why && <p className="truncate text-xs text-muted-foreground/80 italic">Why now: {step.why}</p>}
    </div>
  );
}

// The live task list of a running session.
export function SessionStepList({ session }: { session: TodaySession }) {
  const current = currentStep(session);
  const progress = sessionProgress(session);
  const focusMs = useSessionFocusMs(session);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {progress.done} of {progress.total} steps done · {formatFocus(focusMs)} focused of {session.minutes} min
      </p>
      <ul className="divide-y divide-border/60">
        {session.steps.map((step) => (
          <li key={step.id} className={cn("flex items-center gap-2 py-2", step === current && "rounded-md")}>
            <StepLine step={step} current={step === current} />
            {step.status === "pending" && <StepActions step={step} />}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Explain id="today.finish">
          <Button size="sm" variant={current ? "ghost" : "default"} onClick={() => void finishTodaySession(session, focusMs)}>
            {current ? "End session" : "Finish"}
          </Button>
        </Explain>
      </div>
    </div>
  );
}
