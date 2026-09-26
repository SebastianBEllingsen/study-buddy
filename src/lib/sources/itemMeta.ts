import type { Checked, ItemFlag, SourceRef } from "../types";
import { resolveSourceName } from "./names";

// Pure, client-safe helpers for the `source` / `flag` fields on generated
// cards and questions (see Checked in lib/types.ts).

export const MAX_ISSUE_CHARS = 500;

export function cleanSourceRef(value: unknown): SourceRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind !== "document" && v.kind !== "note") return undefined;
  if (!Number.isInteger(v.id) || (v.id as number) <= 0) return undefined;
  if (typeof v.title !== "string" || !v.title.trim()) return undefined;
  return { kind: v.kind, id: v.id as number, title: v.title.trim().slice(0, 300) };
}

export function cleanItemFlag(value: unknown): ItemFlag | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.by !== "check" && v.by !== "student") return undefined;
  if (typeof v.issue !== "string" || typeof v.at !== "string") return undefined;
  return { by: v.by, issue: v.issue.trim().slice(0, MAX_ISSUE_CHARS), at: v.at };
}

// Keeps a valid source/flag and drops anything else under those keys.
export function withCheckedMeta<T extends Checked>(item: T): T {
  const { source, flag, ...rest } = item;
  const cleanSource = cleanSourceRef(source);
  const cleanFlag = cleanItemFlag(flag);
  return { ...rest, ...(cleanSource && { source: cleanSource }), ...(cleanFlag && { flag: cleanFlag }) } as T;
}

// Generation asks the model for each item's source by section name; this
// swaps that name for the section's reference (or drops it when the name
// doesn't match a section).
export function attachSources<T extends { source?: unknown }>(items: T[], sources: SourceRef[]): T[] {
  return items.map((item) => {
    const { source, ...rest } = item;
    const resolved = typeof source === "string" ? resolveSourceName(source, sources) : cleanSourceRef(source);
    return (resolved ? { ...rest, source: resolved } : rest) as T;
  });
}

export function isHeldBack(item: Checked | undefined): boolean {
  return !!item?.flag;
}
