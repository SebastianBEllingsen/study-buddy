"use client";

import { Explain } from "@/components/Explain";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlarmClock, ArrowRight, Check, ExternalLink, SkipForward } from "lucide-react";
import { cn } from "cn";
import type { TodayStep } from "@/lib/today/planDay";
import {
  currentStep,
  finishedPlanSessions,
  sessionProgress,
  setStepStatus,
  snoozeStep,
  type SessionStep,
  type TodaySession,
} from "@/lib/today/session";
import { Button } from "@/components/ui/button";
import { saveTodaySession, updateTodaySession } from "./todayStore";

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
export function useOpenStep() {
  const router = useRouter();
  return (step: Pick<TodayStep, "href" | "external">) => {
    if (step.external) window.open(step.href, "_blank", "noopener,noreferrer");
    else router.push(step.href);
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

// Finishing the day marks the plan sessions whose work got done.
export async function finishTodaySession(session: TodaySession) {
  for (const s of finishedPlanSessions(session)) {
    await post("/api/today/complete", { type: "session", ...s });
  }
  saveTodaySession(null);
}

export function StepActions({ step, compact }: { step: SessionStep; compact?: boolean }) {
  const open = useOpenStep();
  const size = compact ? "icon-xs" : "icon-sm";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Explain id="today.go">
        <Button size={compact ? "xs" : "sm"} variant="outline" onClick={() => open(step)}>
          {step.external ? <ExternalLink className="size-3.5" /> : <ArrowRight className="size-3.5" />}
          Go
        </Button>
      </Explain>
      <Explain id="today.done">
        <Button size={size} variant="ghost" aria-label="Done" onClick={() => void completeTodayStep(step)}>
          <Check />
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

export function StepLine({ step, current }: { step: TodayStep & { status?: SessionStep["status"] }; current?: boolean }) {
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
      </p>
    </div>
  );
}

// The live task list of a running session.
export function SessionStepList({ session }: { session: TodaySession }) {
  const current = currentStep(session);
  const progress = sessionProgress(session);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {progress.done} of {progress.total} steps done · {progress.minutesDone} of {session.minutes} min
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
          <Button size="sm" variant={current ? "ghost" : "default"} onClick={() => void finishTodaySession(session)}>
            {current ? "End session" : "Finish"}
          </Button>
        </Explain>
      </div>
    </div>
  );
}
