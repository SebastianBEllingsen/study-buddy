"use client";

import { Children, useEffect, useState, type ComponentType, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Element as HastElement, ElementContent } from "hast";
import {
  Bug,
  Check,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Flame,
  Info,
  List,
  Pencil,
  Quote,
  TriangleAlert,
  X,
  Zap,
  type LucideProps,
} from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";
import type { LinkTargets } from "@/lib/models";
import { buildNoteLinkHref, parseNoteLinks, resolveNoteLinkTarget } from "@/lib/noteLinks";
import { fetchNoteImage, NOTE_IMAGE_SCHEME, noteImageCache } from "@/lib/noteImages";
import { headingSlug, newNoteHref, parseWikiLinks, resolveWikiLink, titleFromNewNoteHref } from "@/lib/obsidianLinks";
import { blankFrontmatter, formatPropertyValue, type NoteProperties } from "@/lib/frontmatter";
import remarkCallouts, { type CalloutType } from "@/lib/callouts";

// A note's rendered (Reading-view) markdown — shared by NoteEditor's
// Preview mode and canvas cards (text cards and embedded notes), so the
// same source renders identically in both places: GFM, line breaks as
// typed, KaTeX math, [[links]] as real links, and studybuddy-image embeds —
// plus the Obsidian extras a vault imported from Obsidian relies on: a
// Properties panel for YAML frontmatter, > [!type] callouts, name-based
// [[Title#Heading|alias]] links (lib/obsidianLinks.ts), and heading anchors
// for them to land on.

// Where the note being rendered lives — lets [[#Heading]] self-links
// resolve, and an unresolved [[New note]] link create that note next to
// this one (same course and folder), the way clicking one does in Obsidian.
// Omitted on canvas cards, where unresolved links just render as text.
export interface NoteLinkContext {
  noteId: number;
  courseId: number;
  folderId: number | null;
}

// Fired after a link creates a note, so every open NoteEditor refetches its
// link targets — the source note is typically still mounted (client-side
// navigation reuses it) and would otherwise keep showing the link as
// unresolved.
export const LINK_TARGETS_CHANGED_EVENT = "study-buddy:link-targets-changed";

export async function createNoteFromLink(title: string, context: NoteLinkContext): Promise<number | null> {
  const res = await fetch(`/api/courses/${context.courseId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, folderId: context.folderId ?? undefined }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(body?.error ?? `Couldn't create "${title}"`);
    return null;
  }
  window.dispatchEvent(new Event(LINK_TARGETS_CHANGED_EVENT));
  return body.note.id as number;
}

// Markdown link text is itself parsed as markdown — escape the characters
// that would end it early or start something else.
function escapeLinkLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

// Swaps every [[type:id|alias]] for a real markdown link the rendered
// Preview can follow — Reading-view equivalent of the clickable pills
// Edit mode shows via wikilinkPills above.
export function markdownForPreview(source: string, targets: LinkTargets): string {
  const matches = parseNoteLinks(source);
  if (matches.length === 0) return source;
  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += source.slice(cursor, match.start);
    const resolved = resolveNoteLinkTarget(match.type, match.id, targets);
    const label = match.alias ?? resolved.label;
    const href = buildNoteLinkHref(match, targets);
    out += href ? `[${label}](${href})` : label;
    cursor = match.end;
  }
  out += source.slice(cursor);
  return out;
}

// Second pass for Obsidian's name-based links — [[Title]] becomes a link to
// that note (plus a #heading fragment), [[#Heading]] a same-note anchor, and
// a title with no note behind it a "create this note" link.
function wikiLinksForPreview(source: string, targets: LinkTargets, currentNoteId?: number): string {
  const matches = parseWikiLinks(source);
  if (matches.length === 0) return source;
  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += source.slice(cursor, match.start);
    const resolved = resolveWikiLink(match, targets, currentNoteId);
    const href = resolved.href ?? newNoteHref(match.target);
    out += `[${escapeLinkLabel(resolved.label)}](${href})`;
    cursor = match.end;
  }
  out += source.slice(cursor);
  return out;
}

const CALLOUT_ICONS: Record<CalloutType, ComponentType<LucideProps>> = {
  note: Pencil,
  abstract: ClipboardList,
  info: Info,
  todo: CircleCheck,
  tip: Flame,
  success: Check,
  question: CircleHelp,
  warning: TriangleAlert,
  failure: X,
  danger: Zap,
  bug: Bug,
  example: List,
  quote: Quote,
};

function CalloutIcon({ type }: { type: string | undefined }) {
  const Icon = CALLOUT_ICONS[type as CalloutType] ?? Pencil;
  return <Icon className="callout-icon" aria-hidden />;
}

function hastText(node: HastElement | ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

// Obsidian's Properties view: one row per key, lists (and tags) as chips.
function PropertiesPanel({ properties }: { properties: NoteProperties }) {
  const entries = Object.entries(properties);
  if (entries.length === 0) return null;
  return (
    <dl className="note-properties">
      {entries.map(([key, value]) => {
        const values = formatPropertyValue(value);
        const isTags = key === "tags" || key === "tag";
        const asChips = isTags || Array.isArray(value);
        return (
          <div key={key} className="note-property">
            <dt>{key}</dt>
            <dd>
              {values.length === 0 ? (
                <span className="note-property-empty">Empty</span>
              ) : asChips ? (
                values.map((v, i) => (
                  <span key={i} className="note-property-chip">
                    {isTags ? `#${v.replace(/^#/, "")}` : v}
                  </span>
                ))
              ) : (
                values[0]
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// Scrolls the rendered heading with this id into view — looked up inside
// the clicked link's own rendered note (not the whole document), since a
// canvas can show several notes that share heading names.
function scrollToAnchor(from: HTMLElement, id: string) {
  const root = from.closest(".markdown-body") ?? document;
  root.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
}

function NoteLinkAnchor({
  href,
  children,
  context,
}: {
  href: string | undefined;
  children: ReactNode;
  context?: NoteLinkContext;
}) {
  const router = useRouter();
  const newTitle = href ? titleFromNewNoteHref(href) : null;

  if (newTitle !== null) {
    if (!context) return <span className="wikilink-missing">{children}</span>;
    return (
      <a
        href={href}
        className="wikilink-missing"
        title={`"${newTitle}" doesn't exist yet — click to create it`}
        onClick={async (e: MouseEvent) => {
          e.preventDefault();
          const id = await createNoteFromLink(newTitle, context);
          if (id !== null) router.push(`/vault/${id}`);
        }}
      >
        {children}
      </a>
    );
  }
  if (href?.startsWith("#")) {
    return (
      <a
        href={href}
        className="wikilink"
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          e.preventDefault();
          scrollToAnchor(e.currentTarget, decodeURIComponent(href.slice(1)));
        }}
      >
        {children}
      </a>
    );
  }
  if (href?.startsWith("/")) {
    return (
      <Link href={href} className={href.startsWith("/vault/") ? "wikilink" : undefined}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function headingComponent(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function Heading({ node, children }: { node?: HastElement; children?: ReactNode }) {
    const id = node ? headingSlug(hastText(node)) : undefined;
    return <Tag id={id || undefined}>{children}</Tag>;
  };
}

const HEADINGS = {
  h1: headingComponent("h1"),
  h2: headingComponent("h2"),
  h3: headingComponent("h3"),
  h4: headingComponent("h4"),
  h5: headingComponent("h5"),
  h6: headingComponent("h6"),
};

// Preview-mode counterpart to NoteImageWidget: ReactMarkdown hands this
// whatever raw src the markdown source carries, which for a pasted picture
// is a studybuddy-image:<id> reference rather than a real URL — resolves it
// through the same cache/fetch every Edit-mode widget already shares, so a
// note switched to Preview shows the actual picture instead of a broken
// image icon.
export function NoteMarkdownImage({ src: rawSrc, alt }: { src?: string | Blob; alt?: string }) {
  // react-markdown types <img>'s src as string | Blob (a plain HTML
  // attribute type, not something this app's own markdown ever actually
  // produces) — a Blob here would mean something upstream is doing
  // something unexpected, so just treat it as "no image" rather than
  // guessing how to render it.
  const src = typeof rawSrc === "string" ? rawSrc : undefined;
  const isNoteImage = !!src && src.startsWith(NOTE_IMAGE_SCHEME);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
    isNoteImage ? (noteImageCache.get(Number(src!.slice(NOTE_IMAGE_SCHEME.length))) ?? null) : (src ?? null)
  );
  // A plain (non-note-image) src change is synced during render — compared
  // against the src resolvedSrc was last computed for — rather than in the
  // effect below, matching this app's established pattern elsewhere for
  // avoiding a synchronous setState inside an effect body. The effect
  // itself is left for what actually needs it: the async fetch when src
  // *is* a note-image reference.
  const [syncedFor, setSyncedFor] = useState(src);
  if (!isNoteImage && src !== syncedFor) {
    setSyncedFor(src);
    setResolvedSrc(src ?? null);
  }

  useEffect(() => {
    if (!isNoteImage) return;
    const id = Number(src!.slice(NOTE_IMAGE_SCHEME.length));
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    fetchNoteImage(id).then((dataUrl) => {
      if (!cancelled && dataUrl) setResolvedSrc(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [src, isNoteImage]);

  if (!resolvedSrc) {
    return <span className="my-2 block h-32 w-full animate-pulse rounded-lg bg-muted" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- a data: URL / user-uploaded image, not a next/image-optimizable asset
  return <img src={resolvedSrc} alt={alt ?? ""} className="rounded-lg border" />;
}

// Without onToggleTask, task-list checkboxes render read-only — e.g. a
// note embedded on a canvas, which is a preview, not an editor.
export default function NoteMarkdown({
  markdown,
  targets,
  onToggleTask,
  context,
}: {
  markdown: string;
  targets: LinkTargets;
  onToggleTask?: (lineIndex: number) => void;
  context?: NoteLinkContext;
}) {
  // Blanked rather than cut, so task-toggle line numbers still match the
  // source — see blankFrontmatter.
  const { properties, markdown: body } = blankFrontmatter(markdown);
  const rendered = wikiLinksForPreview(markdownForPreview(body, targets), targets, context?.noteId);
  return (
    <>
      {properties && <PropertiesPanel properties={properties} />}
      <ReactMarkdown
        // remarkBreaks: a plain Enter in the editor is just a newline in the
        // raw source, but CommonMark treats a single newline inside a
        // paragraph as nothing (soft-wraps, no visible break) — without
        // this, pressing Enter looks identical to Edit but disappears in
        // Preview. This turns every source newline into a real line break,
        // matching what you actually typed.
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath, remarkCallouts]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        // react-markdown sanitizes every href/src through its own built-in
        // urlTransform by default, allow-listing only http(s)/irc(s)/
        // mailto/xmpp — a studybuddy-image: reference isn't a URL a browser
        // would ever navigate to or fetch on its own (NoteMarkdownImage
        // resolves it itself, via a same-origin API call), so it's safe to
        // let through unchanged; everything else still goes through the
        // default sanitizer, same protection as before for a link/image a
        // note's own markdown might otherwise carry.
        urlTransform={(url) => (url.startsWith(NOTE_IMAGE_SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => (
            <NoteLinkAnchor href={href} context={context}>
              {children}
            </NoteLinkAnchor>
          ),
          ...HEADINGS,
          // Callout titles (see lib/callouts.ts) get their type's icon; every
          // other div/summary renders as-is.
          div: ({ node, children, ...rest }) => {
            const isTitle =
              typeof rest.className === "string" && rest.className.split(" ").includes("callout-title");
            return (
              <div {...rest}>
                {isTitle && <CalloutIcon type={String(node?.properties?.dataCallout ?? "")} />}
                {children}
              </div>
            );
          },
          summary: ({ node, children, ...rest }) => (
            <summary {...rest}>
              <CalloutIcon type={String(node?.properties?.dataCallout ?? "")} />
              {children}
            </summary>
          ),
          img: ({ src, alt }) => <NoteMarkdownImage src={src} alt={alt} />,
          // A wide table shouldn't force the whole note wider (or scroll
          // horizontally itself, per the artifact-design "wrap wide content
          // in its own overflow-x container" rule) — the table scrolls
          // inside this wrapper instead. See globals.css's .markdown-body
          // table rules for the actual borders/header styling.
          table: ({ children }) => (
            <div className="markdown-body-table-wrap">
              <table>{children}</table>
            </div>
          ),
          // remark-gfm marks a task-list <li>'s hast node with a checkbox as
          // its first child, but that child <input> itself carries no source
          // position (it's synthesized from the parent listItem's `checked`
          // boolean, not its own parsed token — confirmed empirically, not
          // just per the type declaring `position` optional). The <li> DOES
          // have a real position, so this drops react-markdown's own
          // (disabled) checkbox from the rendered children and replaces it
          // with a controlled one that toggles by the <li>'s own source
          // line — stable and pure, unlike a "how many checkboxes have
          // rendered so far" counter would be under React's dev-mode
          // double-invoking of component renders.
          li: ({ node, children, className, ...rest }) => {
            const inputNode = node?.children.find(
              (c): c is Extract<typeof c, { tagName: string }> => "tagName" in c && c.tagName === "input"
            );
            if (!node || !inputNode || node.position === undefined) {
              return (
                <li className={className} {...rest}>
                  {children}
                </li>
              );
            }
            const checked = Boolean(inputNode.properties?.checked);
            const line = node.position.start.line - 1;
            return (
              <li className={className} {...rest}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!onToggleTask}
                  onChange={() => onToggleTask?.(line)}
                  className="cursor-pointer align-middle accent-focus disabled:cursor-default"
                />
                {Children.toArray(children).slice(1)}
              </li>
            );
          },
        }}
      >
        {normalizeLatexDelimiters(rendered)}
      </ReactMarkdown>
    </>
  );
}
