import { RESOURCE_KINDS, type ChapterLevel, type ResourceKind, type Subtopic } from "./types";
import type { ChapterPatch, ResourcePatch } from "./store";
import type { SyllabusSource } from "./generatePlan";

// Request-body validation for the study-plan routes, kept pure (no DB) so
// every rule here is unit-testable on its own. Each parser returns either
// the cleaned value or a user-facing error for a 400.

const MAX_TITLE = 200;
const MAX_SUMMARY = 1000;
const MAX_SUBTOPIC = 300;
const MAX_SUBTOPICS = 50;
const MAX_NOTE = 500;
const MAX_URL = 2000;
const MAX_PASTED_SYLLABUS = 100_000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isIntArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => Number.isInteger(v));
}

export function parseSyllabusSource(value: unknown): Parsed<SyllabusSource> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "object") return { ok: false, error: "Invalid syllabus" };
  const v = value as Record<string, unknown>;
  if ("documentId" in v) {
    return Number.isInteger(v.documentId)
      ? { ok: true, value: { documentId: v.documentId as number } }
      : { ok: false, error: "Invalid syllabus document" };
  }
  if (typeof v.text === "string") {
    const text = v.text.trim();
    if (!text) return { ok: true, value: null };
    if (text.length > MAX_PASTED_SYLLABUS) return { ok: false, error: "The pasted syllabus is too long" };
    return { ok: true, value: { text } };
  }
  return { ok: false, error: "Invalid syllabus" };
}

function parseSubtopics(value: unknown): Subtopic[] | null {
  if (!Array.isArray(value) || value.length > MAX_SUBTOPICS) return null;
  const subtopics: Subtopic[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { text, done } = item as Record<string, unknown>;
    if (typeof text !== "string" || typeof done !== "boolean") return null;
    const trimmed = text.trim();
    if (!trimmed) continue;
    subtopics.push({ text: trimmed.slice(0, MAX_SUBTOPIC), done });
  }
  return subtopics;
}

export function parseChapterPatch(body: Record<string, unknown>): Parsed<ChapterPatch> {
  const patch: ChapterPatch = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) return { ok: false, error: "Title is required" };
    patch.title = body.title.trim().slice(0, MAX_TITLE);
  }
  if ("summary" in body) {
    if (typeof body.summary !== "string") return { ok: false, error: "Invalid summary" };
    patch.summary = body.summary.trim().slice(0, MAX_SUMMARY);
  }
  if ("subtopics" in body) {
    const subtopics = parseSubtopics(body.subtopics);
    if (!subtopics) return { ok: false, error: "Invalid subtopics" };
    patch.subtopics = subtopics;
  }
  if ("stage" in body) {
    if (!Number.isInteger(body.stage) || (body.stage as number) < 1 || (body.stage as number) > 100) {
      return { ok: false, error: "Stage must be a whole number from 1 to 100" };
    }
    patch.stage = body.stage as number;
  }
  if ("linkedDocumentIds" in body) {
    if (!isIntArray(body.linkedDocumentIds)) return { ok: false, error: "Invalid linked documents" };
    patch.linked_document_ids = [...new Set(body.linkedDocumentIds)];
  }
  if ("completed" in body) {
    if (typeof body.completed !== "boolean") return { ok: false, error: "Invalid completed flag" };
    patch.completed = body.completed;
  }
  return { ok: true, value: patch };
}

export function parseNewChapter(
  body: Record<string, unknown>
): Parsed<{ title: string; summary: string; subtopics: string[]; stage?: number }> {
  if (typeof body.title !== "string" || !body.title.trim()) return { ok: false, error: "Title is required" };
  if (body.stage !== undefined && (!Number.isInteger(body.stage) || (body.stage as number) < 1 || (body.stage as number) > 100)) {
    return { ok: false, error: "Stage must be a whole number from 1 to 100" };
  }
  const subtopics = Array.isArray(body.subtopics)
    ? body.subtopics
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .slice(0, MAX_SUBTOPICS)
        .map((s) => s.trim().slice(0, MAX_SUBTOPIC))
    : [];
  return {
    ok: true,
    value: {
      title: body.title.trim().slice(0, MAX_TITLE),
      summary: typeof body.summary === "string" ? body.summary.trim().slice(0, MAX_SUMMARY) : "",
      subtopics,
      ...(body.stage !== undefined ? { stage: body.stage as number } : {}),
    },
  };
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseKind(value: unknown): ResourceKind | null {
  return (RESOURCE_KINDS as readonly unknown[]).includes(value) ? (value as ResourceKind) : null;
}

export function parseNewResource(
  body: Record<string, unknown>
): Parsed<{ title: string; url: string; kind: ResourceKind; note: string }> {
  const url = parseUrl(body.url);
  if (!url) return { ok: false, error: "Enter a valid http(s) link" };
  const kind = body.kind === undefined ? "article" : parseKind(body.kind);
  if (!kind) return { ok: false, error: "Invalid resource type" };
  const title =
    typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, MAX_TITLE) : new URL(url).hostname;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
  return { ok: true, value: { title, url, kind, note } };
}

export function parseResourcePatch(body: Record<string, unknown>): Parsed<ResourcePatch> {
  const patch: ResourcePatch = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) return { ok: false, error: "Title is required" };
    patch.title = body.title.trim().slice(0, MAX_TITLE);
  }
  if ("url" in body) {
    const url = parseUrl(body.url);
    if (!url) return { ok: false, error: "Enter a valid http(s) link" };
    patch.url = url;
  }
  if ("kind" in body) {
    const kind = parseKind(body.kind);
    if (!kind) return { ok: false, error: "Invalid resource type" };
    patch.kind = kind;
  }
  if ("note" in body) {
    if (typeof body.note !== "string") return { ok: false, error: "Invalid note" };
    patch.note = body.note.trim().slice(0, MAX_NOTE);
  }
  if ("done" in body) {
    if (typeof body.done !== "boolean") return { ok: false, error: "Invalid done flag" };
    patch.done = body.done;
  }
  return { ok: true, value: patch };
}

export function parseOrderedIds(value: unknown): number[] | null {
  return isIntArray(value) && new Set(value).size === value.length ? value : null;
}

const LEVELS: ChapterLevel[] = ["new", "familiar", "known"];

// { "<chapterId>": "new" | "familiar" | "known", … } from the topic-level step.
export function parseChapterLevels(value: unknown): Map<number, ChapterLevel> | null {
  if (value === undefined || value === null) return new Map();
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const levels = new Map<number, ChapterLevel>();
  for (const [key, level] of Object.entries(value)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !LEVELS.includes(level as ChapterLevel)) return null;
    levels.set(id, level as ChapterLevel);
  }
  return levels;
}
