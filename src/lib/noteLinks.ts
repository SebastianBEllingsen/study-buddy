import type { LinkTargets } from "@/lib/models";

// Shared syntax for the Vault's internal links — [[note:12]], optionally
// with a #<url-encoded snippet> deep-link anchor and a |Alias display label,
// e.g. [[doc:7#Amdahl%27s%20law|Amdahl's law]]. Notes are the only place
// this syntax is authored (via NoteEditor's inline "[[" completion for
// notes, or its "Insert link" dialog for documents/generated items) — it's
// never meant to be hand-typed, which is why the snippet is percent-encoded
// rather than kept readable: it can contain "]", "|", or "#" verbatim.
export type NoteLinkType = "note" | "doc" | "item";

export interface NoteLinkTarget {
  type: NoteLinkType;
  id: number;
  snippet?: string;
  alias?: string;
}

export interface NoteLinkMatch extends NoteLinkTarget {
  raw: string;
  start: number;
  end: number;
}

const LINK_RE = /\[\[(note|doc|item):(\d+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g;

// The snippet is normally percent-encoded by buildNoteLinkSyntax below, but
// this syntax can also appear in hand-typed or pasted/imported text (e.g. a
// note *about* the app's own link syntax) where it isn't — decodeURIComponent
// throws on a "%" that isn't a valid escape, which would otherwise take down
// every other note's backlink computation along with this one (see
// getNoteBacklinks in models.ts, which parses every note's markdown).
function decodeSnippet(snippet: string): string {
  try {
    return decodeURIComponent(snippet);
  } catch {
    return snippet;
  }
}

export function parseNoteLinks(markdown: string): NoteLinkMatch[] {
  const matches: NoteLinkMatch[] = [];
  for (const m of markdown.matchAll(LINK_RE)) {
    const [raw, type, idStr, snippet, alias] = m;
    matches.push({
      raw,
      start: m.index,
      end: m.index + raw.length,
      type: type as NoteLinkType,
      id: Number(idStr),
      snippet: snippet ? decodeSnippet(snippet) : undefined,
      alias,
    });
  }
  return matches;
}

export function buildNoteLinkSyntax(target: NoteLinkTarget): string {
  const snippetPart = target.snippet ? `#${encodeURIComponent(target.snippet)}` : "";
  const aliasPart = target.alias ? `|${target.alias}` : "";
  return `[[${target.type}:${target.id}${snippetPart}${aliasPart}]]`;
}

// For search snippets/candidates — the raw [[type:id#snippet|alias]] syntax
// isn't meaningful as plain text, so swap each link for its alias (the
// human-readable label it was inserted with) or drop it if it has none.
export function stripNoteLinkSyntax(markdown: string): string {
  return markdown.replace(LINK_RE, (_raw, _type, _id, _snippet, alias) => alias ?? "");
}

// Display label for a link target, looked up in the (small, client-side)
// listing from /api/link-targets — shared by NoteEditor's pills, its
// Preview, and canvas cards, so a deleted target reads the same everywhere.
export function resolveNoteLinkTarget(
  type: NoteLinkType,
  id: number,
  targets: LinkTargets
): { label: string; missing: boolean } {
  if (type === "note") {
    const n = targets.notes.find((n) => n.id === id);
    return n ? { label: n.title, missing: false } : { label: "Missing note", missing: true };
  }
  if (type === "doc") {
    const d = targets.documents.find((d) => d.id === id);
    return d ? { label: d.filename, missing: false } : { label: "Missing document", missing: true };
  }
  const i = targets.items.find((i) => i.id === id);
  return i ? { label: i.title, missing: false } : { label: "Missing item", missing: true };
}

// Where following a link goes, or null if its target no longer exists. A
// snippet becomes a ?highlight= so the destination scrolls to it.
export function buildNoteLinkHref(target: NoteLinkTarget, targets: LinkTargets): string | null {
  const highlight = target.snippet ? `?highlight=${encodeURIComponent(target.snippet)}` : "";
  if (target.type === "note") {
    const n = targets.notes.find((n) => n.id === target.id);
    return n ? `/vault/${target.id}${highlight}` : null;
  }
  if (target.type === "doc") {
    const d = targets.documents.find((d) => d.id === target.id);
    if (!d) return null;
    const base = `/courses/${d.courseId}?document=${target.id}`;
    return target.snippet ? `${base}&${highlight.slice(1)}` : base;
  }
  const i = targets.items.find((i) => i.id === target.id);
  return i ? `/items/${target.id}${highlight}` : null;
}
