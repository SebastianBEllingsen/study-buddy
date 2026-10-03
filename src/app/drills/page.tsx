"use client";

import { useSyncExternalStore } from "react";
import { DrillRunner } from "@/components/drills/DrillRunner";
import { Skeleton } from "@/components/ui/skeleton";

// A drill's numbers are random, so it's drawn only in the browser — the
// server-rendered page would otherwise show different numbers to the ones the
// browser then picks.
const subscribe = () => () => {};

export default function DrillsPage() {
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false);
  return inBrowser ? <DrillRunner /> : <Skeleton className="mx-auto h-64 max-w-3xl rounded-xl" />;
}
