"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { newChapterQuizSteps } from "@/lib/today/session";
import { useTodaySession, useTodaySync } from "./todayStore";
import { useOpenStep } from "./TodaySteps";

// Always mounted (from the root layout), so a running Today session keeps
// in step with the plan on every page, not only while the Today card or the
// timer menu is open — and tells you the moment a chapter's study steps are
// done and its quiz is next.
export function TodayWatcher() {
  const session = useTodaySession();
  useTodaySync(session, { refreshOnProgress: true });
  const open = useOpenStep();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  // The step ids last seen, for the session they belong to: the first look
  // at a session only takes note, so what's already in it (or left from
  // before a reload) never announces itself.
  const seen = useRef<{ startedAt: number; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!session) {
      seen.current = null;
      return;
    }
    const known = seen.current;
    seen.current = { startedAt: session.startedAt, ids: new Set(session.steps.map((s) => s.id)) };
    if (!known || known.startedAt !== session.startedAt) return;
    for (const step of newChapterQuizSteps(session, known.ids)) {
      toast("Study steps done — time for the quiz", {
        // Same id per step, so two tabs or a double render show one toast.
        id: `chapter-quiz:${step.id}`,
        description: step.title,
        duration: 20_000,
        action: { label: "Go", onClick: () => openRef.current(step) },
      });
    }
  }, [session]);

  return null;
}
