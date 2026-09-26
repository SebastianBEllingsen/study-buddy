import { MAX_ISSUE_CHARS } from "./itemMeta";
import { isSourceTrust, type SourceTrust } from "./types";

// Request-body parsing for the flag and source routes — pure, so it's
// testable without the route handlers.

export type FlagRequest =
  | { index: number; action: "report"; issue: string }
  | { index: number; action: "keep" | "remove" | "suggest" }
  | { index: number; action: "save"; entry: unknown };

export function parseFlagRequest(body: Record<string, unknown>): FlagRequest | null {
  const index = body.index;
  if (!Number.isInteger(index) || (index as number) < 0) return null;
  const i = index as number;
  switch (body.action) {
    case "report": {
      if (body.issue !== undefined && typeof body.issue !== "string") return null;
      return { index: i, action: "report", issue: ((body.issue as string | undefined) ?? "").slice(0, MAX_ISSUE_CHARS) };
    }
    case "keep":
    case "remove":
    case "suggest":
      return { index: i, action: body.action };
    case "save":
      if (!body.entry || typeof body.entry !== "object") return null;
      return { index: i, action: "save", entry: body.entry };
    default:
      return null;
  }
}

// { trust } for a document; { generationSource } (null = excluded) for a note.
export function parseTrust(value: unknown): SourceTrust | null {
  return isSourceTrust(value) ? value : null;
}

export function parseGenerationSource(value: unknown): SourceTrust | null | undefined {
  if (value === null) return null;
  return isSourceTrust(value) ? value : undefined;
}
