"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { useRouter } from "next/navigation";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
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
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc.toString();
    const sel = view.state.selection.main;
    for (const match of parseNoteLinks(doc)) {
      if (sel.from <= match.end && sel.to >= match.start) continue;
      builder.add(match.start, match.end, Decoration.replace({ widget: new LinkWidget(match, targets, onNavigate) }));
    }
    return builder.finish();
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

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "0.9375rem",
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
  ".cm-highlight-flash": {
    backgroundColor: "color-mix(in srgb, var(--amber) 40%, transparent)",
    borderRadius: "0.2em",
    transition: "background-color 1s",
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

export interface NoteEditorHandle {
  scrollToHighlight: (text: string) => void;
}

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { value, onChange },
  ref
) {
  const router = useRouter();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [targets, setTargets] = useState<LinkTargets>(EMPTY_TARGETS);
  const [insertLinkOpen, setInsertLinkOpen] = useState(false);

  function loadTargets() {
    fetch("/api/link-targets")
      .then((r) => r.json())
      .then(setTargets);
  }

  useEffect(loadTargets, []);

  useImperativeHandle(ref, () => ({
    scrollToHighlight: (text: string) => {
      const view = editorRef.current?.view;
      if (view) highlightInEditor(view, text);
    },
  }));

  const onNavigate = useMemo(() => (href: string) => router.push(href), [router]);

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      autocompletion({ override: [noteLinkCompletionSource(targets)] }),
      wikilinkPills(targets, onNavigate),
      highlightField,
      editorTheme,
    ],
    [targets, onNavigate]
  );

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
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setInsertLinkOpen(true)}>
          <Link2 className="size-3.5" />
          Insert link
        </Button>
        <span className="text-xs text-muted-foreground">
          Type <code className="rounded bg-muted px-1 py-0.5">[[</code> to link a note
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          height="100%"
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
