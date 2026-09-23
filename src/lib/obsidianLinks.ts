import type { LinkTargets } from "@/lib/models";

// Obsidian's own name-based wikilinks — [[Note title]], [[Note title|alias]],
// [[Note title#Heading]], and [[#Heading]] (a heading in the current note) —
// as opposed to this app's id-based [[note:12]] syntax in lib/noteLinks.ts.
// Those id links are what the editor's "[[" completion inserts, but notes
// pasted or imported from an Obsidian vault are written by name, so both
// have to render as links. Note titles are unique (case-insensitively, see
// assertTitleAvailable in models.ts), so a name always resolves to at most
// one note.

export interface WikiLinkMatch {
  raw: string;
  start: number;
  end: number;
  // Note title as written; "" for a same-note [[#Heading]] link.
  target: string;
  heading?: string;
  alias?: string;
}

// Anything that isn't the id syntax noteLinks.ts already owns, and isn't an
// ![[embed]] (the negative lookbehind).
const WIKI_RE = /(?<!!)\[\[(?!(?:note|doc|item):\d)([^\[\]\n]+?)\]\]/g;

// Fenced code blocks and inline code spans — [[...]] inside them is literal
// text, not a link, exactly as in Obsidian.
function codeRanges(markdown: string): [number, number][] {
  const ranges: [number, number][] = [];
  let open: { start: number; marker: string } | null = null;
  let pos = 0;
  for (const line of markdown.split("\n")) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!open) open = { start: pos, marker: fence[1] };
      else if (fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length) {
        ranges.push([open.start, pos + line.length]);
        open = null;
      }
    }
    pos += line.length + 1;
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
  if (open) ranges.push([open.start, markdown.length]);
  // A code span can wrap lines but never crosses a blank line (paragraph
  // break), so a stray unmatched backtick can't swallow later links.
  const inline = /(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g;
  for (const m of markdown.matchAll(inline)) {
    if (!ranges.some(([s, e]) => m.index >= s && m.index < e)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

export function parseWikiLinks(markdown: string): WikiLinkMatch[] {
  const code = codeRanges(markdown);
  const matches: WikiLinkMatch[] = [];
  for (const m of markdown.matchAll(WIKI_RE)) {
    const start = m.index;
    if (code.some(([s, e]) => start >= s && start < e)) continue;
    // Inside a table cell Obsidian writes the alias pipe escaped (\|) so it
    // doesn't split the cell — accept either form.
    const inner = m[1];
    const pipe = inner.search(/\\?\|/);
    const linkPart = pipe === -1 ? inner : inner.slice(0, pipe);
    const alias = pipe === -1 ? undefined : inner.slice(pipe).replace(/^\\?\|/, "").trim() || undefined;
    const hash = linkPart.indexOf("#");
    const target = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim();
    const heading = hash === -1 ? undefined : linkPart.slice(hash + 1).trim() || undefined;
    if (!target && !heading) continue;
    matches.push({ raw: m[0], start, end: start + m[0].length, target, heading, alias });
  }
  return matches;
}

// GitHub-style heading slug, used both for the heading ids Preview renders
// and for the #fragment a [[...#Heading]] link points at, so the two always
// agree. Unicode letters/digits survive (Norwegian headings like "Lineær
// algebra" keep their æ); emoji and punctuation are dropped.
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function findNoteByTitle(title: string, targets: LinkTargets): LinkTargets["notes"][number] | undefined {
  const needle = title.trim().toLowerCase();
  return targets.notes.find((n) => n.title.toLowerCase() === needle);
}

export interface ResolvedWikiLink {
  // Where following the link goes — null when it names a note that doesn't
  // exist yet (Obsidian's "unresolved link", which creates it on click).
  href: string | null;
  label: string;
  missing: boolean;
}

export function resolveWikiLink(
  match: Pick<WikiLinkMatch, "target" | "heading" | "alias">,
  targets: LinkTargets,
  currentNoteId?: number
): ResolvedWikiLink {
  const fragment = match.heading ? `#${headingSlug(match.heading)}` : "";
  const defaultLabel = match.target
    ? match.heading
      ? `${match.target} › ${match.heading}`
      : match.target
    : (match.heading ?? "");
  const label = match.alias ?? defaultLabel;

  if (!match.target) return { href: fragment, label, missing: false };
  const note = findNoteByTitle(match.target, targets);
  if (!note) return { href: null, label, missing: true };
  if (note.id === currentNoteId) return { href: fragment || `/vault/${note.id}`, label, missing: false };
  return { href: `/vault/${note.id}${fragment}`, label, missing: false };
}

// Prefix for the in-preview href of an unresolved link — NoteMarkdown's <a>
// renderer recognizes it and creates the note on click instead of
// navigating. A fragment so react-markdown's URL sanitizer lets it through.
export const NEW_NOTE_HREF_PREFIX = "#wikilink-new:";

export function newNoteHref(title: string): string {
  return `${NEW_NOTE_HREF_PREFIX}${encodeURIComponent(title)}`;
}

export function titleFromNewNoteHref(href: string): string | null {
  if (!href.startsWith(NEW_NOTE_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(NEW_NOTE_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

// Whether `markdown` links by name to the note titled `title` — backs
// getNoteBacklinks' name-based half. Returns each match so the caller can
// build context snippets from their offsets.
export function wikiLinksToTitle(markdown: string, title: string): WikiLinkMatch[] {
  const needle = title.trim().toLowerCase();
  return parseWikiLinks(markdown).filter((m) => m.target.toLowerCase() === needle);
}
