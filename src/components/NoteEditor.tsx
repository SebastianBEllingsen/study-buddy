"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  autocompletion,
  snippet,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import { toast } from "sonner";
import { MATH_PATTERN, normalizeLatexDelimiters } from "@/lib/mathSanitizer";
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
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { resizeImageForNote } from "@/lib/resizeImage";
import { uploadImage } from "@/lib/uploadImage";

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

// Pictures pasted/dropped into a note (see noteImagePasteDrop below) are
// uploaded once and referenced in the markdown source by this short pseudo-
// scheme plus their uploaded_images row id — never the raw data URL, which
// for a real photo/screenshot can run to hundreds of KB of base64 text.
// Obsidian's own approach for a pasted image is the same idea (a short
// wikilink to a saved file, not the image data inline); this is this app's
// equivalent, since there's no separate attachments folder to save a real
// file into — everything already lives in the uploaded_images table.
const NOTE_IMAGE_SCHEME = "studybuddy-image:";
// Custom drag payload type for reordering an already-embedded image within
// the note (see the widget's dragstart and moveNoteImageLine below) — an OS
// file drag (Finder/Explorer) never sets this, so the drop handler can tell
// the two apart before deciding what to do with a drop.
const NOTE_IMAGE_MOVE_MIME = "application/x-studybuddy-note-image";

// Resolved data URLs are cached at module scope (not per-editor-instance)
// since the same image id can appear in more than one place across a
// session — Preview and Edit mode both render the same reference
// independently, and switching notes shouldn't mean re-fetching an image
// already seen once.
const noteImageCache = new Map<number, string>();
const noteImageFetches = new Map<number, Promise<string>>();

function fetchNoteImage(id: number): Promise<string> {
  const cached = noteImageCache.get(id);
  if (cached) return Promise.resolve(cached);
  const inFlight = noteImageFetches.get(id);
  if (inFlight) return inFlight;
  const promise = fetch(`/api/uploaded-images/${id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { image?: { url: string } } | null) => {
      const url = body?.image?.url ?? "";
      if (url) noteImageCache.set(id, url);
      noteImageFetches.delete(id);
      return url;
    });
  noteImageFetches.set(id, promise);
  return promise;
}

class NoteImageWidget extends WidgetType {
  constructor(readonly imageId: number) {
    super();
  }

  eq(other: NoteImageWidget): boolean {
    return other.imageId === this.imageId;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-note-image";
    wrapper.title = "Drag to reposition — click to edit";
    wrapper.draggable = true;

    const img = document.createElement("img");
    img.alt = "";
    wrapper.appendChild(img);

    const cached = noteImageCache.get(this.imageId);
    if (cached) {
      img.src = cached;
    } else {
      wrapper.classList.add("cm-note-image-loading");
      fetchNoteImage(this.imageId).then((dataUrl) => {
        if (!dataUrl) return;
        img.src = dataUrl;
        wrapper.classList.remove("cm-note-image-loading");
      });
    }

    wrapper.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(NOTE_IMAGE_MOVE_MIME, String(this.imageId));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Renders every studybuddy-image:<id> as the actual picture, concealing the
// raw ![](...) syntax the same way markdownLinkPills conceals a real link —
// except on whatever line the cursor is currently on, where it drops back
// to editable raw text.
function noteImagePills(): Extension {
  function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const sel = view.state.selection.main;
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter: (node) => {
          if (node.name !== "Image") return;
          const reveal = sel.from <= node.to && sel.to >= node.from;
          if (reveal) return;
          const urlNode = node.node.getChild("URL");
          if (!urlNode) return;
          const url = view.state.sliceDoc(urlNode.from, urlNode.to);
          if (!url.startsWith(NOTE_IMAGE_SCHEME)) return;
          const imageId = Number(url.slice(NOTE_IMAGE_SCHEME.length));
          if (!Number.isFinite(imageId)) return;
          ranges.push(Decoration.replace({ widget: new NoteImageWidget(imageId) }).range(node.from, node.to));
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

// Moves the line holding image `imageId` to wherever the drop landed (see
// NoteImageWidget's dragstart) — snapped to the start of the target line,
// so a dropped image always lands as its own line rather than splicing into
// the middle of whatever text happened to be there. Searches the CURRENT
// document for the image's marker rather than trusting a position captured
// at dragstart, so it stays correct even if the document changed (e.g. the
// user kept typing) in between.
function moveNoteImageLine(view: EditorView, imageId: number, event: DragEvent) {
  const doc = view.state.doc;
  const marker = `(${NOTE_IMAGE_SCHEME}${imageId})`;
  const idx = doc.toString().indexOf(marker);
  if (idx < 0) return;
  const line = doc.lineAt(idx);
  const from = line.from;
  const to = line.to < doc.length ? line.to + 1 : line.to; // swallow one trailing newline, if any

  // precise: false — always returns an estimate rather than null for
  // coordinates the precise algorithm doesn't consider "covered" by the
  // rendered viewport (e.g. right at an edge, or a line not yet measured).
  // An estimate is exactly as good as an exact position here anyway, since
  // this only ever snaps to whichever line it lands nearest to.
  const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  const dropLine = doc.lineAt(Math.min(dropPos, doc.length));
  const insertAt = dropLine.from;
  if (insertAt >= from && insertAt <= to) return; // dropped on (or right next to) itself

  const lineText = `${doc.sliceString(line.from, line.to)}\n`;
  // Both change specs are given in the ORIGINAL document's coordinates —
  // CodeMirror composes simultaneous changes itself, so insertAt doesn't
  // need manually adjusting for the deletion even when it falls after it.
  view.dispatch({
    changes: [
      { from, to, insert: "" },
      { from: insertAt, insert: lineText },
    ],
  });
}

// Uploads `file` (resized, transparency preserved — see resizeImageForNote)
// and replaces a placeholder inserted at `insertPos` with the real
// reference once that finishes. The placeholder carries a random token so
// it can be found again by exact text match regardless of how long the
// upload takes or what the user typed elsewhere in the meantime — simpler
// and just as reliable as mapping a raw position through arbitrary
// intervening edits.
async function insertNoteImage(view: EditorView, file: File, insertPos: number): Promise<void> {
  const token = Math.random().toString(36).slice(2);
  const placeholder = `![Uploading image…](pending:${token})`;
  view.dispatch({
    changes: { from: insertPos, insert: placeholder },
    selection: EditorSelection.cursor(insertPos + placeholder.length),
  });

  function replacePlaceholder(withText: string) {
    const idx = view.state.doc.toString().indexOf(placeholder);
    if (idx < 0) return;
    view.dispatch({ changes: { from: idx, to: idx + placeholder.length, insert: withText } });
  }

  try {
    const blob = await resizeImageForNote(file);
    const url = await uploadImage(blob, "note");
    const res = await fetch("/api/uploaded-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "note", url }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? "Upload failed");
    noteImageCache.set(body.image.id, url);
    replacePlaceholder(`![](${NOTE_IMAGE_SCHEME}${body.image.id})`);
  } catch {
    replacePlaceholder("");
    toast.error("Couldn't add that image");
  }
}

// Handles both directions at once since they share the same "is this an
// image?" triage and upload path: pasting an image from the clipboard, and
// dropping one or more image files from outside the browser (an OS file
// drag — see moveNoteImageLine above for dragging an *already-embedded*
// image to reorder it, which is a different drag payload entirely).
function noteImagePasteDrop(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      if (!items) return false;
      const file = Array.from(items)
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!file) return false;
      event.preventDefault();
      insertNoteImage(view, file, view.state.selection.main.head);
      return true;
    },
    drop(event, view) {
      const movedImageId = event.dataTransfer?.getData(NOTE_IMAGE_MOVE_MIME);
      if (movedImageId) {
        event.preventDefault();
        moveNoteImageLine(view, Number(movedImageId), event);
        return true;
      }

      const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return false;
      event.preventDefault();
      // precise: false — see moveNoteImageLine's comment on the same call.
      const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      // Sequential, not Promise.all — each file's placeholder needs the
      // document left by the previous one's insert, not the pre-drop one.
      (async () => {
        let at = dropPos;
        for (const file of files) {
          await insertNoteImage(view, file, at);
          at = view.state.selection.main.head;
        }
      })();
      return true;
    },
  });
}

// Matches a list item's marker — leading indent, the bullet/number itself,
// and the whitespace after it — i.e. exactly the prefix a wrapped line
// should align under. Used only to measure that prefix's width, never to
// touch the text itself (unlike concealment elsewhere in this file, list
// markers stay visible; only where a *wrapped* continuation lands changes).
const LIST_MARKER_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/;

// A long list item currently wraps flush to the editor's left edge, same as
// any other paragraph — Obsidian (and Preview's own <ul>/<ol> via
// globals.css) instead hang-indents a wrapped line under the item's text, so
// it doesn't read as a new, unrelated line. CSS can do this natively via a
// negative text-indent (pulls the line's first visual row back by the
// marker's width) paired with matching padding-left (pushes every row,
// wrapped ones included, out by that same width) — only the amount has to
// be computed per line, since marker width varies ("- " vs "12. " vs a
// nested "  - "). See the matching --cm-line-indent variable in editorTheme.
function listHangingIndent(): Extension {
  function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        const match = LIST_MARKER_RE.exec(line.text);
        if (match) {
          const width = match[0].length;
          ranges.push(
            Decoration.line({
              attributes: { style: `--cm-line-indent: ${width}ch; text-indent: -${width}ch;` },
            }).range(line.from)
          );
        }
        pos = line.to + 1;
      }
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
        if (update.docChanged || update.viewportChanged) {
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

// Renders a matched $...$/$$...$$ span as actual KaTeX, concealing the raw
// delimiters — same Obsidian-style live-preview idea as liveMarkdownFormatting
// above, just driven by MATH_PATTERN (regex) instead of the syntax tree,
// since @codemirror/lang-markdown doesn't parse math as its own node type.
class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly displayMode: boolean
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.displayMode === this.displayMode;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.displayMode ? "cm-math cm-math-display" : "cm-math cm-math-inline";
    try {
      katex.render(this.tex, span, { displayMode: this.displayMode, throwOnError: false });
    } catch {
      span.textContent = this.tex;
    }
    return span;
  }

  // false — a click inside the rendered widget should still place the
  // cursor there via CodeMirror's normal posAtDOM handling, which makes the
  // decoration's range overlap the selection and reveals the raw source on
  // the next rebuild (matches every other concealable span in this file).
  ignoreEvent(): boolean {
    return false;
  }
}

function liveMathFormatting(): Extension {
  function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const doc = view.state.doc.toString();
    const sel = view.state.selection.main;
    for (const match of doc.matchAll(MATH_PATTERN)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (sel.from <= to && sel.to >= from) continue; // cursor inside -> reveal raw source
      // A replace decoration can't span multiple lines unless marked
      // `block`, which in turn requires the range to sit exactly on line
      // boundaries — not guaranteed for a $$...$$ that wraps mid-line.
      // Multi-line display math is rare enough to just leave un-rendered
      // in Edit mode (it still renders fine in Preview) rather than take on
      // that complexity.
      if (view.state.doc.lineAt(from).number !== view.state.doc.lineAt(to).number) continue;
      const [, display, inline, displayLatex, inlineLatex] = match;
      const tex = display ?? displayLatex ?? inline ?? inlineLatex ?? "";
      const isDisplay = display !== undefined || displayLatex !== undefined;
      ranges.push(Decoration.replace({ widget: new MathWidget(tex, isDisplay) }).range(from, to));
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

// A GFM table row: starts and ends with "|" (the toolbar's own insertTable
// always produces this shape; a row without the outer pipes is valid GFM
// too but deliberately out of scope here to keep detection simple).
function isTableRowLine(text: string): boolean {
  return /^\s*\|.*\|\s*$/.test(text);
}

// The "| --- | :--: | --- |"-style delimiter row that marks the line right
// after a table's header — every cell (pipe-separated, outer pipes
// optional) must be only dashes with optional leading/trailing colons
// (alignment markers).
function isTableSeparatorLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("-")) return false;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = inner.split("|").map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

interface TableBlock {
  from: number;
  to: number;
  headerLine: { from: number; to: number };
  sepLine: { from: number; to: number };
  dataLines: { from: number; to: number }[];
}

// Scans the whole document for contiguous table blocks (header line,
// separator line, zero or more data lines) — line-based rather than
// MATH_PATTERN's whole-doc regex since a table's shape is inherently about
// which lines follow which, not a single matchable span.
function findTableBlocks(state: EditorState): TableBlock[] {
  const blocks: TableBlock[] = [];
  const doc = state.doc;
  let lineNo = 1;
  while (lineNo <= doc.lines) {
    const headerLine = doc.line(lineNo);
    if (
      isTableRowLine(headerLine.text) &&
      lineNo + 1 <= doc.lines &&
      isTableSeparatorLine(doc.line(lineNo + 1).text)
    ) {
      const sepLine = doc.line(lineNo + 1);
      const dataLines: { from: number; to: number }[] = [];
      let next = lineNo + 2;
      while (next <= doc.lines && isTableRowLine(doc.line(next).text)) {
        const l = doc.line(next);
        dataLines.push({ from: l.from, to: l.to });
        next++;
      }
      blocks.push({
        from: headerLine.from,
        to: dataLines.length > 0 ? dataLines[dataLines.length - 1].to : sepLine.to,
        headerLine: { from: headerLine.from, to: headerLine.to },
        sepLine: { from: sepLine.from, to: sepLine.to },
        dataLines,
      });
      lineNo = next;
    } else {
      lineNo++;
    }
  }
  return blocks;
}

// Dispatched once the page's web font(s) finish loading — see
// liveTableFormatting's constructor below for why a table's column widths
// need an explicit nudge to recompute at that point instead of just waiting
// for the next real edit/scroll.
const tableFontsReadyEffect = StateEffect.define<null>();

// A little breathing room beyond the widest cell's own measured content, and
// a floor so a column of all-empty/tiny cells (a fresh table, say) doesn't
// collapse to nothing.
const TABLE_COLUMN_PADDING_PX = 22;
const MIN_TABLE_COLUMN_PX = 48;
// A hard ceiling regardless of content — without it, one cell holding a
// markdown link with a long URL (see approximateCellWidthPx below for the
// common case that's stripped out before measuring, and why raw source
// length is the wrong thing to measure at all) or any other outlier could
// force the whole column absurdly wide instead of just wrapping.
const MAX_TABLE_COLUMN_PX = 420;

// A single offscreen canvas reused for every measurement — creating one is
// cheap but not free, and this can run on every keystroke inside a table.
let tableMeasureCtx: CanvasRenderingContext2D | null = null;

// Real rendered pixel width, not a `ch`-unit guess — `ch` resolves against
// whichever font/weight the *element carrying it* happens to use, so a bold
// header cell (or one in a different font, before this stopped happening —
// see .cm-table-cell-header's own comment) would compute a different pixel
// width than a data cell for the exact same `Nch` value, throwing the
// header out of alignment with its own column. Measuring in px against one
// canonical font (the editor's own base font, i.e. what a plain data cell
// actually renders with) sidesteps that regardless of what styling any
// particular cell carries.
function measureCellWidthPx(view: EditorView, text: string): number {
  if (!tableMeasureCtx) {
    tableMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!tableMeasureCtx) return text.length * 8; // canvas unsupported — a rough fallback, better than crashing
  tableMeasureCtx.font = getComputedStyle(view.contentDOM).font;
  // A "[label](url)" link collapses to just its label once concealed (see
  // markdownLinkPills), so measuring the full string including the URL
  // would wildly overestimate that column's real width — strip it first.
  const collapsed = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  return Math.min(tableMeasureCtx.measureText(collapsed).width, MAX_TABLE_COLUMN_PX);
}

// One width per header column, wide enough for that column's longest cell
// anywhere in the block — computed from state.doc directly (the whole
// document, not just what's currently rendered), which matters because
// CodeMirror only keeps lines near the viewport in the DOM and substitutes
// everything else with a single non-table-row `.cm-gap` placeholder (see
// decorateTableRow's own comment below for why that number has to be
// stamped onto every cell rather than left for the browser to figure out).
// A data row with more cells than the header just has its overflow ignored
// (nothing to compare against); one with fewer only contributes to the
// columns it actually has.
function computeColumnWidths(view: EditorView, block: TableBlock): number[] {
  const state = view.state;
  const widths = tableCellsInLine(state, block.headerLine).map((c) =>
    Math.max(measureCellWidthPx(view, state.sliceDoc(c.from, c.to)) + TABLE_COLUMN_PADDING_PX, MIN_TABLE_COLUMN_PX)
  );
  for (const dataLine of block.dataLines) {
    tableCellsInLine(state, dataLine).forEach((c, i) => {
      if (i >= widths.length) return;
      const width = measureCellWidthPx(view, state.sliceDoc(c.from, c.to)) + TABLE_COLUMN_PADDING_PX;
      if (width > widths[i]) widths[i] = width;
    });
  }
  return widths;
}

// Conceals a row's "|" delimiters and marks the text between them as table
// cells — CSS (display: table-row / table-cell, see editorTheme below) does
// the actual grid alignment. Adjacent display:table-row lines would get
// browsers' own anonymous display:table wrapper for free (no real <table>
// element needed) *if* they were always DOM siblings — but CodeMirror only
// renders lines near the current viewport and stands the rest in with a
// single `.cm-gap` div, which isn't a table-row and so breaks a long table
// into several independent anonymous tables as the DOM re-renders around
// scrolling. Each one would size its columns only from whichever rows it
// happens to contain, drifting out of alignment with the others — stamping
// every cell with the same explicit min-width (computed once across the
// *whole* block in computeColumnWidths, not just the rendered rows) keeps
// every fragment sized the same regardless of how the viewport splits them.
function decorateTableRow(
  state: EditorState,
  line: { from: number; to: number },
  isHeader: boolean,
  columnWidths: number[],
  ranges: Range<Decoration>[]
) {
  ranges.push(Decoration.line({ class: "cm-table-row" }).range(line.from));
  const text = state.sliceDoc(line.from, line.to);
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|") pipes.push(line.from + i);
  }
  for (const p of pipes) {
    ranges.push(Decoration.replace({}).range(p, p + 1));
  }
  for (let k = 0; k < pipes.length - 1; k++) {
    const from = pipes[k] + 1;
    const to = pipes[k + 1];
    if (to > from) {
      const width = columnWidths[k] ?? MIN_TABLE_COLUMN_PX;
      ranges.push(
        Decoration.mark({
          class: isHeader ? "cm-table-cell cm-table-cell-header" : "cm-table-cell",
          attributes: { style: `min-width: ${width}px` },
          // A cell written as "|[label](url) |" (no space right after the
          // pipe — common, since nothing enforces one) puts the link's own
          // replace-widget decoration (see markdownLinkPills) at the exact
          // same start offset as this mark. Without inclusiveStart, a mark
          // decoration doesn't claim content that begins exactly at its own
          // boundary, so the widget rendered as a sibling *before* this
          // span instead of inside it — visually escaping the cell
          // entirely and landing wherever normal (non-table) inline flow
          // would have put it, which is what actually produced the
          // "columns randomly drift" symptom, not a width miscalculation.
          // inclusiveEnd for the same reason at a cell's closing boundary
          // (e.g. "|...[label](url)|" with no trailing space either).
          inclusiveStart: true,
          inclusiveEnd: true,
        }).range(from, to)
      );
    }
  }
}

function liveTableFormatting(): Extension {
  function build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const sel = view.state.selection.main;
    for (const block of findTableBlocks(view.state)) {
      if (sel.from <= block.to && sel.to >= block.from) continue; // cursor inside -> reveal raw source
      const columnWidths = computeColumnWidths(view, block);
      decorateTableRow(view.state, block.headerLine, true, columnWidths, ranges);
      // The separator row carries no information once the grid itself
      // communicates column boundaries — collapsed to near-zero height
      // (editorTheme's .cm-table-sep-row) rather than shown as a row of
      // literal dashes.
      ranges.push(Decoration.line({ class: "cm-table-sep-row" }).range(block.sepLine.from));
      if (block.sepLine.to > block.sepLine.from) {
        ranges.push(Decoration.replace({}).range(block.sepLine.from, block.sepLine.to));
      }
      for (const dataLine of block.dataLines) {
        decorateTableRow(view.state, dataLine, false, columnWidths, ranges);
      }
    }
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
        // measureCellWidthPx measures against whatever font is actually
        // loaded at the instant it runs — on first paint, the page's web
        // font can still be loading, so this initial build under-measures
        // every cell and bakes that too-narrow width into the DOM as an
        // inline style. Nothing below (docChanged/selectionSet/
        // viewportChanged) ever fires just because a font finished loading
        // in the background, so without this, whichever rows happened to
        // render before the font was ready keep their stale, narrower
        // width forever — misaligned against any row a later edit/scroll
        // happens to re-decorate after the font *is* loaded, which is
        // exactly the "some rows line up, some don't" pattern this caused.
        document.fonts.ready.then(() => {
          view.dispatch({ effects: tableFontsReadyEffect.of(null) });
        });
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(tableFontsReadyEffect)))
        ) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// Whether `pos` sits inside an as-yet-unclosed math span — used to gate the
// LaTeX command autocomplete (below) so it doesn't fire on a stray "\" in
// ordinary prose. Deliberately looser than MATH_PATTERN (which only matches
// a *complete* pair): while composing an expression the closing delimiter
// hasn't been typed yet, and that's exactly when autocomplete is useful.
function isInsideMathAt(state: EditorState, pos: number): boolean {
  // Display math ($$...$$) can legitimately span multiple lines, so this
  // needs the whole document up to the cursor.
  const before = state.doc.toString().slice(0, pos);
  const displayOpen = (before.match(/\$\$/g)?.length ?? 0) % 2 === 1;
  if (displayOpen) return true;

  // Inline math ($...$) never crosses a line (MATH_PATTERN itself forbids
  // it), so this only looks at the current line — an unrelated stray "$"
  // elsewhere in the note (e.g. a price) can't corrupt the open/closed
  // state for a line it isn't even on.
  const line = state.doc.lineAt(pos);
  const lineBefore = state.doc.sliceString(line.from, pos).replace(/\$\$/g, "");
  const inlineOpen = (lineBefore.match(/\$/g)?.length ?? 0) % 2 === 1;
  return inlineOpen;
}

// Overleaf-style "\command" completion, active only inside a math span.
// Commands that take arguments insert `{}` as snippet tab stops (Tab moves
// through them, same as any other CodeMirror snippet) rather than plain
// text, so e.g. picking \frac lands the cursor ready to type the numerator.
const LATEX_COMPLETIONS: Completion[] = [
  snippetCompletion("\\frac{${}}{${}}", { label: "\\frac", detail: "fraction" }),
  snippetCompletion("\\sqrt{${}}", { label: "\\sqrt", detail: "square root" }),
  snippetCompletion("\\sqrt[${}]{${}}", { label: "\\sqrt[n]", detail: "nth root" }),
  snippetCompletion("\\sum_{${}}^{${}}", { label: "\\sum", detail: "summation" }),
  snippetCompletion("\\prod_{${}}^{${}}", { label: "\\prod", detail: "product" }),
  snippetCompletion("\\int_{${}}^{${}}", { label: "\\int", detail: "integral" }),
  snippetCompletion("\\lim_{${} \\to ${}}", { label: "\\lim", detail: "limit" }),
  snippetCompletion("\\binom{${}}{${}}", { label: "\\binom", detail: "binomial coefficient" }),
  snippetCompletion("\\text{${}}", { label: "\\text", detail: "text in math mode" }),
  snippetCompletion("\\mathbb{${}}", { label: "\\mathbb", detail: "blackboard bold" }),
  snippetCompletion("\\mathbf{${}}", { label: "\\mathbf", detail: "bold" }),
  snippetCompletion("\\mathcal{${}}", { label: "\\mathcal", detail: "calligraphic" }),
  snippetCompletion("\\overline{${}}", { label: "\\overline", detail: "overline" }),
  snippetCompletion("\\underline{${}}", { label: "\\underline", detail: "underline" }),
  snippetCompletion("\\hat{${}}", { label: "\\hat", detail: "hat accent" }),
  snippetCompletion("\\vec{${}}", { label: "\\vec", detail: "vector arrow" }),
  snippetCompletion("\\dot{${}}", { label: "\\dot", detail: "dot accent" }),
  snippetCompletion("\\begin{pmatrix} ${a} & ${b} \\\\ ${c} & ${d} \\end{pmatrix}", {
    label: "\\begin{pmatrix}",
    detail: "2x2 matrix",
  }),
  ...[
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma",
    "tau", "upsilon", "phi", "chi", "psi", "omega",
  ].map((name) =>
    snippetCompletion(`\\${name}`, { label: `\\${name}`, detail: "greek letter", type: "constant" })
  ),
  ...["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega"].map((name) =>
    snippetCompletion(`\\${name}`, { label: `\\${name}`, detail: "greek letter (upper)", type: "constant" })
  ),
  ...(
    [
      ["cdot", "·"], ["times", "×"], ["div", "÷"], ["pm", "±"], ["mp", "∓"],
      ["infty", "∞"], ["partial", "∂"], ["nabla", "∇"],
      ["leq", "≤"], ["geq", "≥"], ["neq", "≠"], ["approx", "≈"], ["equiv", "≡"], ["propto", "∝"],
      ["in", "∈"], ["notin", "∉"], ["subset", "⊂"], ["subseteq", "⊆"], ["cup", "∪"], ["cap", "∩"],
      ["forall", "∀"], ["exists", "∃"],
      ["rightarrow", "→"], ["leftarrow", "←"], ["Rightarrow", "⇒"], ["Leftarrow", "⇐"],
      ["leftrightarrow", "↔"], ["Leftrightarrow", "⇔"],
    ] as const
  ).map(([name, symbol]) =>
    snippetCompletion(`\\${name}`, { label: `\\${name}`, detail: symbol, type: "keyword" })
  ),
];

function latexCompletionSource(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\\[a-zA-Z]*/);
  if (!before) return null;
  if (!isInsideMathAt(context.state, context.pos)) return null;
  return { from: before.from, options: LATEX_COMPLETIONS, validFor: /^\\[a-zA-Z]*$/ };
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
  ".cm-line": {
    padding: "0 1.25rem",
    // --cm-line-indent is 0 on ordinary lines and set per-line (to the list
    // marker's own width) by listHangingIndent above — declared after the
    // padding shorthand so it overrides just the left side, same base gutter
    // otherwise.
    "--cm-line-indent": "0px",
    paddingLeft: "calc(1.25rem + var(--cm-line-indent))",
  },
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
  // A pasted/dropped picture — see noteImagePills/NoteImageWidget above.
  // display:block (despite being an inline-replace decoration structurally)
  // so it reads as its own line rather than sitting inline with text either
  // side of it, matching how "![](url)" alone on a line normally looks.
  ".cm-note-image": {
    display: "block",
    margin: "0.5em 0",
    cursor: "grab",
  },
  ".cm-note-image img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "24rem",
    borderRadius: "0.5em",
    border: "1px solid var(--border)",
  },
  ".cm-note-image-loading img": {
    minHeight: "4rem",
    minWidth: "6rem",
    backgroundColor: "var(--muted)",
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
  // Rendered KaTeX — see MathWidget/liveMathFormatting above.
  ".cm-math": { cursor: "text" },
  // display:inline-block (rather than this) collapses to 0 computed width
  // here specifically — confirmed empirically, not just suspected: a
  // math-only list item (e.g. "- $p$", nothing else on the line) sits right
  // after listHangingIndent's negative text-indent, and Chromium's
  // shrink-to-fit sizing for an inline-block whose content is short enough
  // apparently miscalculates against that indent and returns 0 (the KaTeX
  // content still paints, since it overflows the collapsed box, but
  // subsequent inline content on the line then gets positioned as if the
  // widget took no space at all, garbling the line). inline-flex sizes
  // correctly in every case tested (single glyph, multi-glyph, with/without
  // a list marker, with/without trailing text) — same visual result
  // otherwise, verticalAlign still applies to a flex item next to text.
  ".cm-math-inline": { display: "inline-flex", verticalAlign: "middle" },
  ".cm-math-display": {
    display: "block",
    margin: "0.5em 0",
    textAlign: "center",
  },
  // Live-preview table grid — see liveTableFormatting above. display:
  // table-row on contiguous .cm-line siblings gets browsers' own anonymous
  // table-wrapper generation for free (no real <table> element needed), so
  // column widths line up across rows exactly like a real table would.
  ".cm-table-row": { display: "table-row" },
  ".cm-table-cell": {
    display: "table-cell",
    padding: "0.3em 0.8em",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
  },
  ".cm-table-cell-header": {
    backgroundColor: "var(--muted)",
    fontWeight: "700",
    // Deliberately no heading-font override (unlike .cm-heading above) —
    // computeColumnWidths' min-width is in `ch` units, which resolve
    // against whichever font the element carrying them actually uses; a
    // header row in a different font than its column's data rows would
    // size to a different pixel width for the exact same `Nch` value,
    // throwing the header out of alignment with the grid below it. Bold +
    // the background/border below is enough to read as a header without it.
    borderBottom: "2px solid var(--border)",
  },
  // The "| --- | --- |" delimiter row carries no information once the grid
  // itself shows column boundaries — collapsed to near-zero height rather
  // than shown as a row of literal dashes. display: table-row (missing here
  // for a while) matters beyond just visual consistency with the header/
  // data rows around it: without it, this line's div reverts to a normal
  // block box, which breaks the contiguous run of table-row siblings the
  // header sits in from the one the data rows sit in — two separate
  // anonymous tables instead of one, each free to size its own columns
  // independently of the other's actual content despite sharing the same
  // min-width (see computeColumnWidths), which is exactly what kept the
  // header's columns drifting slightly out of alignment with the data
  // grid below it even after that min-width fix.
  ".cm-table-sep-row": {
    display: "table-row",
    fontSize: "0px",
    lineHeight: "0px",
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

// Preview-mode counterpart to NoteImageWidget: ReactMarkdown hands this
// whatever raw src the markdown source carries, which for a pasted picture
// is a studybuddy-image:<id> reference rather than a real URL — resolves it
// through the same cache/fetch every Edit-mode widget already shares, so a
// note switched to Preview shows the actual picture instead of a broken
// image icon.
function NoteMarkdownImage({ src: rawSrc, alt }: { src?: string | Blob; alt?: string }) {
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
        }}
      >
        {normalizeLatexDelimiters(markdownForPreview(markdown, targets))}
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
  // Lets a parent (e.g. the title field above this editor in vault/[noteId]/
  // page.tsx) react to Edit/Preview switching — Preview is read-only for the
  // body, and the title should follow suit rather than staying editable
  // while everything below it isn't.
  onModeChange?: (mode: "edit" | "preview") => void;
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

const DEFAULT_TABLE_ROWS = 3;
const DEFAULT_TABLE_COLS = 3;
// Arbitrary but generous — tableTabCommand can always grow a table by one
// row at a time from here anyway, this cap just keeps the size popover's
// inputs (and the snippet template below) from accepting something absurd.
const MAX_TABLE_DIMENSION = 20;

// Inserts a `rows`x`cols` GFM table skeleton as a snippet — a single ${}
// field on the header's first cell gives it the initial cursor position
// (see the LATEX_COMPLETIONS snippets above for the same mechanism); every
// other cell is plain "  " padding, since tableTabCommand below (bound to
// Tab/Shift-Tab whenever the cursor sits inside a table — see
// findTableBlocks) is what actually drives cell-to-cell navigation and
// appends further rows Obsidian-style, same as liveTableFormatting gives
// tables their own live-rendered grid in Edit mode already.
function insertTable(view: EditorView, rows: number = DEFAULT_TABLE_ROWS, cols: number = DEFAULT_TABLE_COLS) {
  const clampedRows = Math.min(Math.max(Math.round(rows) || 1, 1), MAX_TABLE_DIMENSION);
  const clampedCols = Math.min(Math.max(Math.round(cols) || 1, 1), MAX_TABLE_DIMENSION);
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  // A table's delimiter row only means anything at the start of its own
  // line — glue it onto existing text instead and GFM won't recognize it as
  // a table at all.
  const needsBreakBefore = before.trim().length > 0;
  const headerRow = `|${Array.from({ length: clampedCols }, (_, i) => (i === 0 ? " ${} " : "  ")).join("|")}|`;
  const sepRow = `|${Array(clampedCols).fill(" --- ").join("|")}|`;
  const dataRow = `|${Array(clampedCols).fill("  ").join("|")}|`;
  const dataRows = Array.from({ length: clampedRows - 1 }, () => dataRow).join("\n");
  const template = `${needsBreakBefore ? "\n\n" : ""}${headerRow}\n${sepRow}\n${dataRows}${dataRows ? "\n" : ""}`;
  snippet(template)(view, null, pos, pos);
  view.focus();
}

// One cell's interior span (the text between its two enclosing "|"s,
// padding spaces included) within a single table row line.
interface TableCellRange {
  from: number;
  to: number;
}

function tableCellsInLine(state: EditorState, line: { from: number; to: number }): TableCellRange[] {
  const text = state.sliceDoc(line.from, line.to);
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|") pipes.push(line.from + i);
  }
  const cells: TableCellRange[] = [];
  for (let k = 0; k < pipes.length - 1; k++) {
    cells.push({ from: pipes[k] + 1, to: pipes[k + 1] });
  }
  return cells;
}

function tableBlockAt(state: EditorState, pos: number): TableBlock | null {
  return findTableBlocks(state).find((b) => pos >= b.from && pos <= b.to) ?? null;
}

// Every cell in a table block, in reading order (header row, then each data
// row) — flattened so "next/previous cell" is just index+1/index-1 across
// the whole table, not something that needs separate row/column bookkeeping.
function flattenTableCells(state: EditorState, block: TableBlock): TableCellRange[] {
  const cells = tableCellsInLine(state, block.headerLine);
  for (const dataLine of block.dataLines) cells.push(...tableCellsInLine(state, dataLine));
  return cells;
}

// Selects a cell's content with its padding spaces trimmed off (so landing
// on a cell and typing replaces just the text, not the " | " spacing that
// keeps the raw source readable) — a collapsed cursor in the middle for an
// already-empty cell, same as clicking into an empty spreadsheet cell.
function trimmedCellSelection(state: EditorState, cell: TableCellRange) {
  const text = state.sliceDoc(cell.from, cell.to);
  const trimmed = text.trim();
  // An empty/whitespace-only cell (the common case: every freshly inserted
  // or newly appended row) has no trimmed content to select — text.trim()
  // returning "" also makes text.indexOf(trimmed) below always match at 0,
  // which would wrongly collapse to the cell's start rather than a sensible
  // typing position, so land in the middle instead, same as clicking into an
  // empty spreadsheet cell.
  if (trimmed.length === 0) {
    return EditorSelection.cursor(cell.from + Math.floor((cell.to - cell.from) / 2));
  }
  const from = cell.from + text.indexOf(trimmed);
  return EditorSelection.range(from, from + trimmed.length);
}

// Obsidian's own table-authoring convenience: Tab/Shift-Tab step between
// cells, and Tab on the table's last cell appends a new empty row and jumps
// into it — the one piece of table editing that's awkward to do by hand
// (adding a row means typing a whole new "| ... |" line in the right place).
// Only fires with the cursor inside a table (tableBlockAt returns null
// otherwise) — falls through (returns false) to CodeMirror's own Tab/
// Shift-Tab handling everywhere else, same as any other keymap command.
function tableTabCommand(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const pos = state.selection.main.head;
    const block = tableBlockAt(state, pos);
    if (!block) return false;
    const cells = flattenTableCells(state, block);
    if (cells.length === 0) return false;
    let idx = cells.findIndex((c) => pos >= c.from && pos <= c.to);
    if (idx === -1) {
      idx = 0;
      let best = Math.abs(cells[0].from - pos);
      for (let i = 1; i < cells.length; i++) {
        const dist = Math.abs(cells[i].from - pos);
        if (dist < best) {
          best = dist;
          idx = i;
        }
      }
    }

    if (forward && idx === cells.length - 1) {
      // Last cell of the table — append a matching empty row right after it
      // and land in its first cell, exactly like Obsidian's own Tab-to-
      // extend-table behavior.
      const cols = tableCellsInLine(state, block.headerLine).length;
      const rowText = `|${Array(cols).fill("  ").join("|")}|`;
      const insertPos = block.to;
      const firstCellFrom = insertPos + "\n".length + "|".length;
      view.dispatch({
        changes: { from: insertPos, to: insertPos, insert: `\n${rowText}` },
        selection: EditorSelection.cursor(firstCellFrom + 1),
        scrollIntoView: true,
      });
      return true;
    }

    const nextIdx = idx + (forward ? 1 : -1);
    if (nextIdx < 0 || nextIdx > cells.length - 1) return false;
    view.dispatch({ selection: trimmedCellSelection(state, cells[nextIdx]), scrollIntoView: true });
    return true;
  };
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

// "Insert table"'s own toolbar button, but opening a small rows x columns
// picker instead of inserting straight away — for anything bigger than the
// 3x3 default, tableTabCommand can still grow it by one row at a time from
// the toolbar's plain button, but typing out a wide table's "| | | | | |"
// header by hand is exactly the tedium this popover exists to skip.
function InsertTableButton({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(DEFAULT_TABLE_ROWS);
  const [cols, setCols] = useState(DEFAULT_TABLE_COLS);

  function submit() {
    onInsert(rows, cols);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setRows(DEFAULT_TABLE_ROWS);
          setCols(DEFAULT_TABLE_COLS);
        }
      }}
    >
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" />}
        aria-label="Insert table"
      >
        <TableIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-xs font-medium text-muted-foreground">Table size</p>
          <div className="flex items-center gap-2">
            <label className="flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Input
                type="number"
                min={1}
                max={MAX_TABLE_DIMENSION}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="h-7 text-sm"
              />
            </label>
            <span className="pt-4 text-xs text-muted-foreground">×</span>
            <label className="flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">Columns</span>
              <Input
                type="number"
                min={1}
                max={MAX_TABLE_DIMENSION}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
                className="h-7 text-sm"
              />
            </label>
          </div>
          <Button type="submit" size="sm" className="w-full">
            Insert
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { value, onChange, onModeChange },
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

  // Fires on every mode change regardless of which code path caused it
  // (the toolbar toggle, Cmd/Ctrl+E, or scrollToHighlight forcing Edit) —
  // an effect keyed on `mode` itself, rather than calling this at each
  // setMode call site, so a parent can never miss one.
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

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
      // markdown() parses the syntax tree but doesn't bind any keys itself —
      // without this, Enter falls through to basicSetup's default binding
      // (plain newline, nothing list-aware), so a new line after "1. " or
      // "- " starts unindented instead of continuing the list/quote the same
      // way Obsidian's editor does. Prec.highest so it's checked before that
      // default Enter binding rather than after it.
      Prec.highest(keymap.of(markdownKeymap)),
      // See tableTabCommand above — only intercepts Tab/Shift-Tab when the
      // cursor is inside a table, and returns false (falling through to
      // CodeMirror's own handling) everywhere else, so Prec.highest here is
      // safe the same way it is for markdownKeymap just above.
      Prec.highest(
        keymap.of([
          { key: "Tab", run: tableTabCommand(true) },
          { key: "Shift-Tab", run: tableTabCommand(false) },
        ])
      ),
      EditorView.lineWrapping,
      autocompletion({ override: [noteLinkCompletionSource(targets), latexCompletionSource] }),
      wikilinkPills(targets, onNavigate),
      markdownLinkPills(),
      noteImagePills(),
      noteImagePasteDrop(),
      listHangingIndent(),
      liveMarkdownFormatting(),
      liveMathFormatting(),
      liveTableFormatting(),
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
            <InsertTableButton onInsert={(rows, cols) => withView((view) => insertTable(view, rows, cols))} />
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
  // Tags each document-lines fetch so a slower, stale response (from
  // quickly picking another document before this one's request resolves)
  // can't land after a newer selection and overwrite its lines — same
  // pattern as SearchDialog's own requestIdRef.
  const docRequestIdRef = useRef(0);

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
    const requestId = ++docRequestIdRef.current;
    if (doc) {
      fetch(`/api/link-targets/document-lines/${doc.id}`)
        .then((r) => r.json())
        .then((body: { lines: string[] }) => {
          if (requestId !== docRequestIdRef.current) return;
          setLines(body.lines);
        });
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
