"use client";

import { currentStep, sessionProgress } from "@/lib/today/session";
import { useTodaySession, useTodaySync } from "./todayStore";
import { StepActions, StepLine, finishTodaySession } from "./TodaySteps";
import { Button } from "@/components/ui/button";

// The running Today session's current step, under the Pomodoro timer —
// reachable from every page through the header chip.
export function TodayMini() {
  const session = useTodaySession();
  useTodaySync(session);
  if (!session) return null;
  const step = currentStep(session);
  const progress = sessionProgress(session);
  return (
    <div className="w-full space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        Today · step {Math.min(progress.done + 1, progress.total)} of {progress.total}
      </p>
      {step ? (
        <div className="space-y-2">
          <StepLine step={step} current />
          <StepActions step={step} compact />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">All steps done.</p>
          <Button size="xs" onClick={() => void finishTodaySession(session)}>
            Finish
          </Button>
        </div>
      )}
    </div>
  );
}
