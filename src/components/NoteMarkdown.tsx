"use client";

import { Children, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeLatexDelimiters } from "@/lib/mathSanitizer";
import type { LinkTargets } from "@/lib/models";
import { buildNoteLinkHref, parseNoteLinks, resolveNoteLinkTarget } from "@/lib/noteLinks";
import { fetchNoteImage, NOTE_IMAGE_SCHEME, noteImageCache } from "@/lib/noteImages";

// A note's rendered (Reading-view) markdown — shared by NoteEditor's
// Preview mode and canvas cards (text cards and embedded notes), so the
// same source renders identically in both places: GFM, line breaks as
// typed, KaTeX math, [[links]] as real links, and studybuddy-image embeds.

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
}: {
  markdown: string;
  targets: LinkTargets;
  onToggleTask?: (lineIndex: number) => void;
}) {
  return (
    <ReactMarkdown
      // remarkBreaks: a plain Enter in the editor is just a newline in the
      // raw source, but CommonMark treats a single newline inside a
      // paragraph as nothing (soft-wraps, no visible break) — without
      // this, pressing Enter looks identical to Edit but disappears in
      // Preview. This turns every source newline into a real line break,
      // matching what you actually typed.
      remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
      rehypePlugins={[rehypeKatex]}
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
        a: ({ href, children }) =>
          href && href.startsWith("/") ? (
            <Link href={href}>{children}</Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
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
      {normalizeLatexDelimiters(markdownForPreview(markdown, targets))}
    </ReactMarkdown>
  );
}
