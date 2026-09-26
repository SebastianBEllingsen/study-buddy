"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { currentStep, setStepStatus, stepForLocation } from "@/lib/today/session";
import { Button } from "@/components/ui/button";
import { saveTodaySession, useTodaySession } from "./todayStore";
import { useOpenStep } from "./TodaySteps";

// At the end of a review, while a Today session runs: the step for this
// page is done, so this goes straight on to the next one.
export function NextTodayStep() {
  const session = useTodaySession();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const open = useOpenStep();
  if (!session) return null;
  const here = stepForLocation(session, search ? `${pathname}?${search}` : pathname);
  const after = here ? setStepStatus(session, here.id, "done") : session;
  const next = currentStep(after);

  return (
    <Button
      onClick={() => {
        saveTodaySession(after);
        if (next) open(next);
      }}
    >
      {next ? `Next: ${next.title}` : "Back to today's plan"}
      <ArrowRight className="size-4" />
    </Button>
  );
}
