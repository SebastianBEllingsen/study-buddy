"use client";

import { createContext, useContext, useMemo } from "react";
import useSWR from "swr";
import {
  createDateFormatter,
  DEFAULT_DATE_FORMAT,
  normalizeDateFormat,
  type DateFormat,
  type DateFormatter,
} from "@/lib/dateFormat";

const DateFormatContext = createContext<DateFormatter>(createDateFormatter(DEFAULT_DATE_FORMAT));

// The chosen date format (Settings), for every date shown in the app. The
// server passes the saved choice in so the first render already uses it;
// a change in Settings then applies everywhere through the settings cache.
export function DateFormatProvider({ initial, children }: { initial: DateFormat; children: React.ReactNode }) {
  const { data } = useSWR<{ dateFormat?: DateFormat }>("/api/settings");
  const format = normalizeDateFormat(data?.dateFormat ?? initial);
  const formatter = useMemo(() => createDateFormatter(format), [format]);
  return <DateFormatContext.Provider value={formatter}>{children}</DateFormatContext.Provider>;
}

export function useDateFormatter(): DateFormatter {
  return useContext(DateFormatContext);
}
