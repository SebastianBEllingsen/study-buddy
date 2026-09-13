"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { GenerationMode } from "@/lib/models";

interface ItemSearchResult {
  kind: "item";
  itemId: number;
  itemTitle: string;
  courseId: number;
  courseName: string;
  mode: GenerationMode;
  snippets: string[];
}

interface DocumentSearchResult {
  kind: "document";
  documentId: number;
  filename: string;
  courseId: number;
  courseName: string;
  snippets: string[];
}

interface NoteSearchResult {
  kind: "note";
  noteId: number;
  noteTitle: string;
  courseId: number;
  courseName: string;
  snippets: string[];
}

type SearchResult = ItemSearchResult | DocumentSearchResult | NoteSearchResult;

const MODE_LABELS: Record<GenerationMode, string> = {
  quiz: "Quiz",
  flashcards: "Flashcards",
  notes: "Notes",
};

export default function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((body: { results: SearchResult[] }) => setResults(body.results))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults([]);
    }
  }

  // Cmd/Ctrl+K opens search from anywhere — a search-heavy app (notes,
  // quizzes, flashcards, and documents across every course) is exactly
  // where a click-only search dialog is the most friction. Also bound to
  // "/" (outside text inputs) as a fallback: Chrome on Windows/Linux
  // reserves Ctrl+K for the address bar at the browser-chrome level, below
  // where page JS can intercept it, so Ctrl+K alone would silently do
  // nothing for most non-Mac users.
  useEffect(() => {
    function toggleOpen() {
      setOpen((prev) => {
        const next = !prev;
        if (!next) {
          setQuery("");
          setResults([]);
        }
        return next;
      });
    }
    function handleKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const target = e.target as HTMLElement | null;
      const isTyping = target && /^(INPUT|TEXTAREA)$/.test(target.tagName);
      const isSlash = e.key === "/" && !isTyping;
      if (!isCmdK && !isSlash) return;
      e.preventDefault();
      toggleOpen();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" />
        Search
        <kbd className="ml-1 hidden rounded border border-border bg-muted px-1 font-sans text-[0.65rem] text-muted-foreground sm:inline">
          /
        </kbd>
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>
            Fuzzy search across your Vault notes, generated notes, quiz questions, flashcards, and
            uploaded documents in every course.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search everything…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Searching…</p>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-sm text-muted-foreground">No matches.</p>
          )}
          {!loading &&
            results.map((r) => {
              // Carries the matched snippet through as ?highlight= so the
              // destination page can scroll to and flash it — see
              // lib/scrollToHighlight.ts (and NoteEditor's own equivalent
              // for Vault notes).
              const highlight = r.snippets[0] ? `highlight=${encodeURIComponent(r.snippets[0])}` : "";
              const href =
                r.kind === "item"
                  ? highlight
                    ? `/items/${r.itemId}?${highlight}`
                    : `/items/${r.itemId}`
                  : r.kind === "note"
                    ? highlight
                      ? `/vault/${r.noteId}?${highlight}`
                      : `/vault/${r.noteId}`
                    : (() => {
                        const base = `/courses/${r.courseId}?document=${r.documentId}`;
                        return highlight ? `${base}&${highlight}` : base;
                      })();
              const key = r.kind === "item" ? `item-${r.itemId}` : r.kind === "note" ? `note-${r.noteId}` : `doc-${r.documentId}`;
              const badgeLabel = r.kind === "item" ? MODE_LABELS[r.mode] : r.kind === "note" ? "Vault" : "Document";
              const titleText = r.kind === "item" ? r.itemTitle : r.kind === "note" ? r.noteTitle : r.filename;

              return (
                <Link
                  key={key}
                  href={href}
                  onClick={() => handleOpenChange(false)}
                  className="block rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Badge variant="outline">{badgeLabel}</Badge>
                    <span className="truncate font-medium">{titleText}</span>
                  </div>
                  <p className="mb-1 text-xs text-muted-foreground">{r.courseName}</p>
                  {r.snippets.map((s, i) => (
                    <p key={i} className="truncate text-xs text-muted-foreground">
                      {s}
                    </p>
                  ))}
                </Link>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
