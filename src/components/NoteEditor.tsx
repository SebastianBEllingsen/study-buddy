"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  EditorSelection,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Bold,
  Italic,
  Strikethrough,
  Code as CodeIcon,
  Heading1,
  Heading2,
  Heading3,
  Eye,
  PencilLine,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LinkTargets } from "@/lib/models";
import { buildNoteLinkSyntax, parseNoteLinks, type NoteLinkMatch, type NoteLinkType } from "@/lib/noteLinks";

const EMPTY_TARGETS: LinkTargets = { notes: [], documents: [], items: [] };

function resolveTarget(
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

function buildHref(match: NoteLinkMatch, targets: LinkTargets): string | null {
  const highlight = match.snippet ? `?highlight=${encodeURIComponent(match.snippet)}` : "";
  if (match.type === "note") {
    const n = targets.notes.find((n) => n.id === match.id);
    return n ? `/vault/${match.id}${highlight}` : null;
  }
  if (match.type === "doc") {
    const d = targets.documents.find((d) => d.id === match.id);
    if (!d) return null;
    const base = `/courses/${d.courseId}?document=${match.id}`;
    return match.snippet ? `${base}&${highlight.slice(1)}` : base;
  }
  const i = targets.items.find((i) => i.id === match.id);
  return i ? `/items/${match.id}${highlight}` : null;
}

const LINK_ICON: Record<NoteLinkType, string> = { note: "◆", doc: "▤", item: "◇" };

class LinkWidget extends WidgetType {
  constructor(
    readonly match: NoteLinkMatch,
    readonly targets: LinkTargets,
    readonly onNavigate: (href: string) => void
  ) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return other.match.raw === this.match.raw && other.targets === this.targets;
  }

  toDOM(): HTMLElement {
    const resolved = resolveTarget(this.match.type, this.match.id, this.targets);
    const span = document.createElement("span");
    span.className = `cm-wikilink${resolved.missing ? " cm-wikilink-missing" : ""}`;
    span.title = resolved.missing
      ? "This link's target no longer exists"
      : "Click to edit — Ctrl/Cmd-click to open";

    const icon = document.createElement("span");
    icon.className = "cm-wikilink-icon";
    icon.textContent = LINK_ICON[this.match.type];
    span.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = this.match.alias ?? resolved.label;
    span.appendChild(text);

    span.addEventListener("mousedown", (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const href = buildHref(this.match, this.targets);
        if (href) this.onNavigate(href);
      }
    });
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Renders every [[...]] span as a clickable pill EXCEPT the one the cursor
// is currently inside — matching Obsidian's live-preview editing model:
// a link looks like a link until you click into it, at which point it
// drops back to raw, editable source.
function wikilinkPills(targets: LinkTargets, onNavigate: (href: string) => void): Extension {
  function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const doc = view.state.doc.toString();
    const sel = view.state.selection.main;
    for (const match of parseNoteLinks(doc)) {
      if (sel.from <= match.end && sel.to >= match.start) continue;
      ranges.push(
        Decoration.replace({ widget: new LinkWidget(match, targets, onNavigate) }).range(match.start, match.end)
      );
    }
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

class MarkdownLinkWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly url: string
  ) {
    super();
  }

  eq(other: MarkdownLinkWidget): boolean {
    return other.text === this.text && other.url === this.url;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-link";
    span.title = "Click to edit — Ctrl/Cmd-click to open";
    span.textContent = this.text;
    span.addEventListener("mousedown", (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        window.open(this.url, "_blank", "noopener,noreferrer");
      }
    });
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Obsidian-style concealment for ordinary markdown links — [text](url) shows
// just the styled text with the destination hidden, except on whatever
// line/span the cursor is touching, where the raw syntax reappears so it
// stays editable. Same idea as wikilinkPills above, but driven by
// CodeMirror's own markdown syntax tree (a real "Link" node) instead of a
// regex — [[...]] isn't valid CommonMark link syntax at all, so the two
// never see the same text.
function markdownLinkPills(): Extension {
  function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const sel = view.state.selection.main;
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter: (node) => {
          if (node.name !== "Link") return;
          const reveal = sel.from <= node.to && sel.to >= node.from;
          if (reveal) return;
          // Read the label/URL off their own mark nodes rather than
          // assuming fixed offsets from node.from — CommonMark allows
          // whitespace inside "( url )", so "]"/"(" aren't always a fixed
          // distance from the destination.
          const closeBracket = node.node.getChildren("LinkMark")[1];
          const urlNode = node.node.getChild("URL");
          if (!closeBracket || !urlNode) return;
          const text = view.state.sliceDoc(node.from + 1, closeBracket.from);
          const url = view.state.sliceDoc(urlNode.from, urlNode.to);
          if (!text || !url) return;
          ranges.push(
            Decoration.replace({ widget: new MarkdownLinkWidget(text, url) }).range(node.from, node.to)
          );
        },
      });
    }
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// Obsidian-style "Live Preview": headings/bold/italic/strikethrough/inline
// code render styled, with their raw markup characters (##, **, _, `, ~~)
// concealed — except on whatever line/span the cursor is currently touching,
// where the raw syntax reappears so it stays editable. Built from the
// markdown language's own syntax tree (the same one @codemirror/lang-markdown
// already parses for you) rather than regex, so it can't drift from what the
// language actually parsed.
const HEADING_LEVEL: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

// Node names whose *Mark children should be concealed unless the selection
// overlaps the node's own range (i.e. you're editing inside it).
const CONCEALABLE_PARENTS = new Set(["StrongEmphasis", "Emphasis", "InlineCode", "Strikethrough"]);

function liveMarkdownFormatting(): Extension {
  function build(view: EditorView): DecorationSet {
    const sel = view.state.selection.main;
    const ranges: Range<Decoration>[] = [];
    const tree = syntaxTree(view.state);

    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter: (node) => {
          const level = HEADING_LEVEL[node.name];
          if (level) {
            const line = view.state.doc.lineAt(node.from);
            ranges.push(Decoration.line({ class: `cm-heading cm-heading-${level}` }).range(line.from));
            return;
          }

          if (node.name === "HeaderMark" && node.node.parent && HEADING_LEVEL[node.node.parent.name]) {
            const parent = node.node.parent;
            const reveal = sel.from <= parent.to && sel.to >= parent.from;
            if (!reveal) {
              let end = node.to;
              if (view.state.doc.sliceString(end, end + 1) === " ") end += 1;
              ranges.push(Decoration.replace({}).range(node.from, end));
            }
            return;
          }

          if (node.name === "StrongEmphasis") {
            ranges.push(Decoration.mark({ class: "cm-strong" }).range(node.from, node.to));
            return;
          }
          if (node.name === "Emphasis") {
            ranges.push(Decoration.mark({ class: "cm-em" }).range(node.from, node.to));
            return;
          }
          if (node.name === "Strikethrough") {
            ranges.push(Decoration.mark({ class: "cm-strike" }).range(node.from, node.to));
            return;
          }
          if (node.name === "InlineCode") {
            ranges.push(Decoration.mark({ class: "cm-inline-code" }).range(node.from, node.to));
            return;
          }

          if (
            (node.name === "EmphasisMark" || node.name === "CodeMark" || node.name === "StrikethroughMark") &&
            node.node.parent &&
            CONCEALABLE_PARENTS.has(node.node.parent.name)
          ) {
            const parent = node.node.parent;
            const reveal = sel.from <= parent.to && sel.to >= parent.from;
            if (!reveal) ranges.push(Decoration.replace({}).range(node.from, node.to));
          }
        },
      });
    }

    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// Typing "[[" opens a fuzzy note picker and inserts [[note:ID|Title]] on
// selection — the quick path for note-to-note links. Documents/generated
// items go through the "Insert link" dialog instead (see InsertLinkDialog),
// since they can carry an optional page/sentence anchor a flat completion
// list isn't a good fit for.
function noteLinkCompletionSource(targets: LinkTargets) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[[^\]]*/);
    if (!before) return null;
    const query = before.text.slice(2).toLowerCase();
    const matches = targets.notes.filter((n) => n.title.toLowerCase().includes(query)).slice(0, 20);
    return {
      from: before.from,
      filter: false,
      options: matches.map((n) => ({
        label: n.title,
        detail: n.courseName,
        type: "text",
        apply: (view: EditorView, _completion, from: number, to: number) => {
          const syntax = buildNoteLinkSyntax({ type: "note", id: n.id, alias: n.title });
          view.dispatch({
            changes: { from, to, insert: syntax },
            selection: EditorSelection.cursor(from + syntax.length),
          });
        },
      })),
    };
  };
}

const setHighlight = StateEffect.define<Range<Decoration>[]>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let deco = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        deco = Decoration.set(effect.value);
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Flashes and scrolls to `text` inside the CodeMirror document — the same
// "navigate and highlight" idea as lib/scrollToHighlight.ts, reimplemented
// against CodeMirror's own selection/decoration model instead of the DOM,
// since a note's body is a live editor, not static rendered markdown.
function highlightInEditor(view: EditorView, text: string) {
  const needle = text.trim();
  if (needle.length < 3) return;
  const doc = view.state.doc.toString();
  const idx = doc.indexOf(needle);
  if (idx === -1) return;

  const from = idx;
  const to = idx + needle.length;
  const mark = Decoration.mark({ class: "cm-highlight-flash" });
  view.dispatch({
    selection: EditorSelection.cursor(to),
    effects: [EditorView.scrollIntoView(from, { y: "center" }), setHighlight.of([mark.range(from, to)])],
  });
  setTimeout(() => {
    view.dispatch({ effects: setHighlight.of([]) });
  }, 1500);
}

// Editor font size is a global, persisted-across-notes preference (like
// Obsidian's "Editor font size" appearance setting) rather than per-note —
// stored under one shared key, applied via a CSS variable both the
// CodeMirror instance and the rendered preview read from.
const FONT_SIZE_KEY = "noteEditorFontSize";
const FONT_SIZES = { sm: "0.8125rem", md: "0.9375rem", lg: "1.0625rem" } as const;
type FontSizeKey = keyof typeof FONT_SIZES;

function readStoredFontSize(): FontSizeKey {
  if (typeof window === "undefined") return "md";
  try {
    const stored = localStorage.getItem(FONT_SIZE_KEY);
    if (stored === "sm" || stored === "md" || stored === "lg") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) — harmless degradation.
  }
  return "md";
}

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "var(--note-font-size)",
    backgroundColor: "transparent",
    color: "var(--foreground)",
    height: "100%",
  },
  ".cm-content": {
    fontFamily: "var(--font-geist-sans), sans-serif",
    padding: "1rem 0",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0 1.25rem" },
  "&.cm-focused": { outline: "none" },
  // @codemirror/view's base theme hardcodes the blinking caret to black
  // (only swapping to a light gray under its own internal "dark" facet,
  // which theme="none" never sets) — override it directly so the caret
  // follows the app's theme instead of a fixed color.
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-gutters": { display: "none" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-wikilink": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.2em",
    padding: "0.05em 0.4em",
    borderRadius: "0.35em",
    backgroundColor: "color-mix(in srgb, var(--focus) 12%, transparent)",
    color: "var(--focus)",
    cursor: "pointer",
  },
  ".cm-wikilink-icon": { fontSize: "0.7em" },
  ".cm-wikilink-missing": {
    backgroundColor: "color-mix(in srgb, var(--clay) 12%, transparent)",
    color: "var(--clay)",
  },
  // Ordinary [text](url) links — plain underlined text, not a pill/badge
  // like .cm-wikilink, matching how these read in Preview and in Obsidian.
  ".cm-md-link": {
    color: "var(--focus)",
    textDecoration: "underline",
    textDecorationColor: "color-mix(in srgb, var(--focus) 45%, transparent)",
    cursor: "pointer",
  },
  ".cm-highlight-flash": {
    backgroundColor: "color-mix(in srgb, var(--amber) 40%, transparent)",
    borderRadius: "0.2em",
    transition: "background-color 1s",
  },
  // Live-preview formatting — see liveMarkdownFormatting() above.
  ".cm-heading": {
    fontFamily: "var(--font-heading)",
    fontWeight: "700",
    lineHeight: "1.3",
  },
  ".cm-heading-1": { fontSize: "1.5em" },
  ".cm-heading-2": { fontSize: "1.3em" },
  ".cm-heading-3": { fontSize: "1.15em" },
  ".cm-heading-4": { fontSize: "1.05em" },
  ".cm-heading-5": { fontSize: "1em" },
  ".cm-heading-6": { fontSize: "0.95em", color: "var(--muted-foreground)" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through" },
  ".cm-inline-code": {
    fontFamily: "var(--font-geist-mono), monospace",
    fontSize: "0.9em",
    backgroundColor: "var(--muted)",
    padding: "0.05em 0.35em",
    borderRadius: "0.3em",
  },
  "&.cm-editor .cm-tooltip-autocomplete": {
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  },
  ".cm-tooltip-autocomplete ul li": {
    color: "var(--popover-foreground)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--focus)",
    color: "var(--primary-foreground)",
  },
});

// Swaps every [[type:id|alias]] for a real markdown link the rendered
// Preview can follow — Reading-view equivalent of the clickable pills
// Edit mode shows via wikilinkPills above.
function markdownForPreview(source: string, targets: LinkTargets): string {
  const matches = parseNoteLinks(source);
  if (matches.length === 0) return source;
  let out = "";
  let cursor = 0;
  for (const match of matches) {
    out += source.slice(cursor, match.start);
    const resolved = resolveTarget(match.type, match.id, targets);
    const label = match.alias ?? resolved.label;
    const href = buildHref(match, targets);
    out += href ? `[${label}](${href})` : label;
    cursor = match.end;
  }
  out += source.slice(cursor);
  return out;
}

function NotePreview({
  markdown,
  targets,
  scrollRef,
}: {
  markdown: string;
  targets: LinkTargets;
  scrollRef: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={scrollRef}
      className="markdown-body h-full overflow-y-auto px-4 py-4"
      style={{ fontSize: "var(--note-font-size)" }}
    >
      <ReactMarkdown
        // remarkBreaks: a plain Enter in the editor is just a newline in the
        // raw source, but CommonMark treats a single newline inside a
        // paragraph as nothing (soft-wraps, no visible break) — without
        // this, pressing Enter looks identical to Edit but disappears in
        // Preview. This turns every source newline into a real line break,
        // matching what you actually typed.
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) =>
            href && href.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {markdownForPreview(markdown, targets)}
      </ReactMarkdown>
    </div>
  );
}

export interface NoteEditorHandle {
  scrollToHighlight: (text: string) => void;
}

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
}

// Wraps (or unwraps, if already wrapped) the current selection with `mark`
// on both sides — the standard toggle behavior for Bold/Italic/Strikethrough/
// inline-code toolbar buttons.
function toggleWrap(view: EditorView, mark: string) {
  const { state } = view;
  const sel = state.selection.main;
  let from = sel.from;
  let to = sel.to;
  if (from !== to) {
    // Trim leading/trailing whitespace out of the selection before
    // wrapping — marks sitting flush against interior whitespace (e.g.
    // "~~text ~~") aren't valid delimiters per the markdown spec, so
    // toggling would silently fail to render even though the raw text
    // looks right. This is why strikethrough (and to a lesser extent
    // bold/italic) would seem to "work sometimes" depending on whether the
    // selection happened to include a stray trailing space.
    const raw = state.sliceDoc(from, to);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      from += raw.indexOf(trimmed);
      to = from + trimmed.length;
    }
  }
  const before = state.sliceDoc(Math.max(0, from - mark.length), from);
  const after = state.sliceDoc(to, to + mark.length);
  if (before === mark && after === mark) {
    view.dispatch({
      changes: [
        { from: from - mark.length, to: from, insert: "" },
        { from: to, to: to + mark.length, insert: "" },
      ],
      selection: EditorSelection.range(from - mark.length, to - mark.length),
    });
  } else {
    view.dispatch({
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      selection: EditorSelection.range(from + mark.length, to + mark.length),
    });
  }
  view.focus();
}

// Sets (or clears, if already at that level) the ATX heading level of the
// line the cursor is on.
function toggleHeading(view: EditorView, level: number) {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  const match = /^(#{1,6})\s+/.exec(line.text);
  const want = `${"#".repeat(level)} `;
  if (match) {
    const currentLevel = match[1].length;
    const insert = currentLevel === level ? "" : want;
    view.dispatch({ changes: { from: line.from, to: line.from + match[0].length, insert } });
  } else {
    view.dispatch({ changes: { from: line.from, insert: want } });
  }
  view.focus();
}

function ToolbarButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { value, onChange },
  ref
) {
  const router = useRouter();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [targets, setTargets] = useState<LinkTargets>(EMPTY_TARGETS);
  const [insertLinkOpen, setInsertLinkOpen] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [fontSize, setFontSize] = useState<FontSizeKey>(readStoredFontSize);
  const pendingHighlightRef = useRef<string | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  // Edit and Preview are unrelated DOM trees (no shared notion of "line N"
  // or character offset), so rather than trying to map a cursor position or
  // a snippet of text from one into the other — which broke in enough edge
  // cases (headings, formatting, repeated text) to make switching feel
  // unreliable — this just carries over *how far down the document you were
  // scrolled*, as a plain 0-1 fraction. Simpler, and never picks a wrong spot.
  const pendingScrollFractionRef = useRef<number | null>(null);

  function loadTargets() {
    fetch("/api/link-targets")
      .then((r) => r.json())
      .then(setTargets);
  }

  useEffect(loadTargets, []);

  function switchMode(next: "edit" | "preview") {
    if (next === mode) return;
    const el = mode === "edit" ? editorRef.current?.view?.scrollDOM : previewScrollRef.current;
    if (el) {
      const scrollable = el.scrollHeight - el.clientHeight;
      pendingScrollFractionRef.current = scrollable > 0 ? el.scrollTop / scrollable : 0;
    }
    setMode(next);
  }

  function applyPendingScrollFraction(el: HTMLElement) {
    if (pendingScrollFractionRef.current === null) return;
    const fraction = pendingScrollFractionRef.current;
    pendingScrollFractionRef.current = null;
    const scrollable = el.scrollHeight - el.clientHeight;
    el.scrollTop = fraction * scrollable;
  }

  // Switching into Preview: a plain div we render ourselves, so its ref is
  // already attached by the time this runs — useLayoutEffect (not useEffect)
  // means it happens before the browser paints, so there's no visible frame
  // at the wrong scroll position first.
  //
  // Switching into Edit is handled separately, via CodeMirror's own
  // onCreateEditor callback below — @uiw/react-codemirror builds the actual
  // EditorView a render cycle after it mounts (container ref → setState →
  // re-render), so editorRef.current?.view is still null when this effect
  // would otherwise fire; onCreateEditor fires at the exact moment the view
  // (and its real scrollHeight) actually exists.
  useLayoutEffect(() => {
    if (mode !== "preview") return;
    const el = previewScrollRef.current;
    if (el) applyPendingScrollFraction(el);
  }, [mode]);

  // Cmd/Ctrl+E toggles Edit/Preview from anywhere on the page — same binding
  // Obsidian uses for the same thing. Re-subscribed on every mode change so
  // switchMode's closure always sees the current mode.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        switchMode(mode === "edit" ? "preview" : "edit");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useImperativeHandle(ref, () => ({
    scrollToHighlight: (text: string) => {
      if (mode !== "edit") {
        pendingHighlightRef.current = text;
        setMode("edit");
        return;
      }
      const view = editorRef.current?.view;
      if (view) highlightInEditor(view, text);
    },
  }));

  // Jumping to a highlight forces edit mode (above) so CodeMirror mounts —
  // run the deferred highlight once it actually has, on the next frame.
  useEffect(() => {
    if (mode !== "edit" || !pendingHighlightRef.current) return;
    const text = pendingHighlightRef.current;
    pendingHighlightRef.current = null;
    // setTimeout rather than requestAnimationFrame — see the same swap
    // above, same reasoning (rAF pauses entirely in a backgrounded tab).
    setTimeout(() => {
      const view = editorRef.current?.view;
      if (view) highlightInEditor(view, text);
    });
  }, [mode]);

  function changeFontSize(next: FontSizeKey) {
    setFontSize(next);
    try {
      localStorage.setItem(FONT_SIZE_KEY, next);
    } catch {
      // localStorage unavailable — harmless, preference just won't persist.
    }
  }

  const onNavigate = useMemo(() => (href: string) => router.push(href), [router]);

  const extensions = useMemo(
    () => [
      // Plain markdown() only parses base CommonMark — pass the GFM-extended
      // language so strikethrough (~~text~~) actually shows up in the syntax
      // tree for liveMarkdownFormatting() to conceal, same as headings/bold.
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      autocompletion({ override: [noteLinkCompletionSource(targets)] }),
      wikilinkPills(targets, onNavigate),
      markdownLinkPills(),
      liveMarkdownFormatting(),
      highlightField,
      editorTheme,
    ],
    [targets, onNavigate]
  );

  function withView(fn: (view: EditorView) => void) {
    const view = editorRef.current?.view;
    if (view) fn(view);
  }

  function handleInsert(syntax: string) {
    const view = editorRef.current?.view;
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: syntax }, selection: EditorSelection.cursor(pos + syntax.length) });
    view.focus();
    // A newly-inserted link's target is always already in `targets` (the
    // dialog only offers existing documents/items), so no refetch needed.
  }

  return (
    <div className="flex h-full flex-col" style={{ "--note-font-size": FONT_SIZES[fontSize] } as React.CSSProperties}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <ToggleGroup
          value={[mode]}
          onValueChange={(v: string[]) => v[0] && switchMode(v[0] as "edit" | "preview")}
          size="sm"
          variant="outline"
        >
          <Tooltip>
            <TooltipTrigger render={<ToggleGroupItem value="edit" aria-label="Edit" />}>
              <PencilLine className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Edit (⌘E)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<ToggleGroupItem value="preview" aria-label="Preview" />}>
              <Eye className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Preview (⌘E)</TooltipContent>
          </Tooltip>
        </ToggleGroup>

        {mode === "edit" && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <ToolbarButton label="Heading 1" onClick={() => withView((v) => toggleHeading(v, 1))}>
              <Heading1 className="size-3.5" />
            </ToolbarButton>
            <ToolbarButton label="Heading 2" onClick={() => withView((v) => toggleHeading(v, 2))}>
              <Heading2 className="size-3.5" />
            </ToolbarButton>
            <ToolbarButton label="Heading 3" onClick={() => withView((v) => toggleHeading(v, 3))}>
              <Heading3 className="size-3.5" />
            </ToolbarButton>
            <div className="mx-1 h-5 w-px bg-border" />
            <ToolbarButton label="Bold" onClick={() => withView((v) => toggleWrap(v, "**"))}>
              <Bold className="size-3.5" />
            </ToolbarButton>
            <ToolbarButton label="Italic" onClick={() => withView((v) => toggleWrap(v, "*"))}>
              <Italic className="size-3.5" />
            </ToolbarButton>
            <ToolbarButton label="Strikethrough" onClick={() => withView((v) => toggleWrap(v, "~~"))}>
              <Strikethrough className="size-3.5" />
            </ToolbarButton>
            <ToolbarButton label="Inline code" onClick={() => withView((v) => toggleWrap(v, "`"))}>
              <CodeIcon className="size-3.5" />
            </ToolbarButton>
            <div className="mx-1 h-5 w-px bg-border" />
            <ToolbarButton label="Insert link" onClick={() => setInsertLinkOpen(true)}>
              <Link2 className="size-3.5" />
            </ToolbarButton>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <ToggleGroup
            value={[fontSize]}
            onValueChange={(v: string[]) => v[0] && changeFontSize(v[0] as FontSizeKey)}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="sm" aria-label="Small text" className="text-xs">
              A
            </ToggleGroupItem>
            <ToggleGroupItem value="md" aria-label="Medium text" className="text-sm">
              A
            </ToggleGroupItem>
            <ToggleGroupItem value="lg" aria-label="Large text" className="text-base">
              A
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {mode === "edit" ? (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirror
              ref={editorRef}
              value={value}
              onChange={onChange}
              extensions={extensions}
              height="100%"
              // Fires the instant the real EditorView exists (see the
              // useLayoutEffect above for why that's not synchronous with
              // this component's own mount) — apply any carried-over scroll
              // position right then, before the first paint.
              onCreateEditor={(view) => applyPendingScrollFraction(view.scrollDOM)}
              // @uiw/react-codemirror's own wrapper <div> (the thing height="100%"
              // above actually lands on is .cm-editor, one level in) otherwise gets
              // no height of its own and grows to fit all content — leaving
              // .cm-scroller nothing to scroll against inside our bounded
              // container. `style` isn't a prop this component recognizes, so it
              // passes straight through to that wrapper div.
              style={{ height: "100%" }}
              // Disable @uiw/react-codemirror's own built-in theme (defaults to
              // "light", which injects a hardcoded white background via its
              // defaultLightThemeOption) — editorTheme above is a complete
              // theme already driven by this app's CSS variables, so the
              // built-in one would fight it in dark/sepia/etc. app themes.
              theme="none"
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
                // Auto-closing "[" as soon as "[[" is typed would leave a
                // stray "]]" sitting past the cursor when a [[ completion is
                // accepted (see noteLinkCompletionSource), producing
                // "[[note:1|Title]]]]" — markdown prose also just has bare
                // brackets far more often than code does, so this isn't a
                // trade worth making for either use case here.
                closeBrackets: false,
              }}
            />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <NotePreview markdown={value} targets={targets} scrollRef={previewScrollRef} />
        </div>
      )}

      <InsertLinkDialog
        open={insertLinkOpen}
        onOpenChange={setInsertLinkOpen}
        targets={targets}
        onInsert={handleInsert}
      />
    </div>
  );
});

export default NoteEditor;

function InsertLinkDialog({
  open,
  onOpenChange,
  targets,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: LinkTargets;
  onInsert: (syntax: string) => void;
}) {
  const [tab, setTab] = useState<"doc" | "item">("doc");
  const [selectedDoc, setSelectedDoc] = useState<LinkTargets["documents"][number] | null>(null);
  const [selectedItem, setSelectedItem] = useState<LinkTargets["items"][number] | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);

  // Reset when the dialog closes — done during render (comparing against
  // the previous `open`) rather than in a useEffect, matching this app's
  // established pattern (see EditFlashcardsDialog) for resetting local
  // state on open/close without an extra render pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setSelectedDoc(null);
      setSelectedItem(null);
      setLines(null);
      setSelectedLine(null);
      setTab("doc");
    }
  }

  function handleDocChange(doc: LinkTargets["documents"][number] | null) {
    setSelectedDoc(doc);
    setLines(null);
    setSelectedLine(null);
    if (doc) {
      fetch(`/api/link-targets/document-lines/${doc.id}`)
        .then((r) => r.json())
        .then((body: { lines: string[] }) => setLines(body.lines));
    }
  }

  function handleInsert() {
    if (tab === "doc" && selectedDoc) {
      onInsert(
        buildNoteLinkSyntax({
          type: "doc",
          id: selectedDoc.id,
          snippet: selectedLine ?? undefined,
          alias: selectedDoc.filename,
        })
      );
    } else if (tab === "item" && selectedItem) {
      onInsert(buildNoteLinkSyntax({ type: "item", id: selectedItem.id, alias: selectedItem.title }));
    }
    onOpenChange(false);
  }

  const canInsert = (tab === "doc" && !!selectedDoc) || (tab === "item" && !!selectedItem);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insert link</DialogTitle>
          <DialogDescription>
            Link to a document (optionally a specific line) or a generated item.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setTab("doc")}
            className={`flex-1 rounded-md px-2 py-1 text-sm ${tab === "doc" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
          >
            Document
          </button>
          <button
            type="button"
            onClick={() => setTab("item")}
            className={`flex-1 rounded-md px-2 py-1 text-sm ${tab === "item" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
          >
            Generated item
          </button>
        </div>

        {tab === "doc" && (
          <div className="space-y-2">
            <Combobox
              items={targets.documents}
              value={selectedDoc}
              onValueChange={handleDocChange}
              itemToStringLabel={(d) => `${d.filename} — ${d.courseName}`}
            >
              <ComboboxInputGroup>
                <ComboboxInput placeholder="Search documents…" />
                <ComboboxIcon />
              </ComboboxInputGroup>
              <ComboboxPopup>
                <ComboboxEmpty>No match</ComboboxEmpty>
                <ComboboxList>
                  {(item: LinkTargets["documents"][number]) => (
                    <ComboboxItem key={item.id} value={item}>
                      <span className="truncate">
                        {item.filename} <span className="text-muted-foreground">— {item.courseName}</span>
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>

            {selectedDoc && (
              <Combobox
                items={lines ?? []}
                value={selectedLine}
                onValueChange={(v) => setSelectedLine(v)}
                itemToStringLabel={(l: string) => l}
              >
                <ComboboxInputGroup>
                  <ComboboxInput placeholder="Optional: search a specific line to link to…" />
                  <ComboboxIcon />
                </ComboboxInputGroup>
                <ComboboxPopup>
                  <ComboboxEmpty>{lines === null ? "Loading…" : "No match"}</ComboboxEmpty>
                  <ComboboxList>
                    {(line: string) => (
                      <ComboboxItem key={line} value={line} className="truncate">
                        {line}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
            )}
          </div>
        )}

        {tab === "item" && (
          <Combobox
            items={targets.items}
            value={selectedItem}
            onValueChange={(v) => setSelectedItem(v)}
            itemToStringLabel={(i) => `${i.title} — ${i.courseName}`}
          >
            <ComboboxInputGroup>
              <ComboboxInput placeholder="Search generated items…" />
              <ComboboxIcon />
            </ComboboxInputGroup>
            <ComboboxPopup>
              <ComboboxEmpty>No match</ComboboxEmpty>
              <ComboboxList>
                {(item: LinkTargets["items"][number]) => (
                  <ComboboxItem key={item.id} value={item}>
                    <span className="truncate">
                      {item.title} <span className="text-muted-foreground">— {item.courseName}</span>
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </Combobox>
        )}

        <DialogFooter>
          <Button onClick={handleInsert} disabled={!canInsert}>
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
