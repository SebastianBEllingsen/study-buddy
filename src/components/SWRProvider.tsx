"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/swrFetcher";

// One cache for the whole app, provided above every route — this is what
// lets a course's data still be there, instantly, when you leave and come
// back a minute later, instead of every page mount starting from a blank
// skeleton and re-fetching from zero. See useSWR() call sites for the
// stale-while-revalidate read side; onSuccess-driven cross-page invalidation
// (e.g. a generation on the course page updating the home dashboard's dot)
// goes through this same cache via useSWRConfig()'s mutate.
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        // Revisiting a tab (or switching back to it) revalidates in the
        // background — this is also what fixes a course card's "just
        // generated" dot or the per-item pill going stale across tabs,
        // without needing a manual reload.
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        // Multiple widgets on one page requesting the same key (e.g. two
        // widgets both reading /api/stats) share a single request instead
        // of firing it twice.
        dedupingInterval: 2000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
