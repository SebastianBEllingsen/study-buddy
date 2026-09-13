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
      snippet: snippet ? decodeURIComponent(snippet) : undefined,
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
