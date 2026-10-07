"use client";

import { useState } from "react";
import { FilePlus2, X } from "lucide-react";
import { cn } from "cn";
import { MAX_PROJECT_FILES, isValidFileName } from "@/lib/code/projectFiles";
import type { CodeLanguage, ProjectFile } from "@/lib/code/types";
import { CodeEditor } from "./CodeEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A project's files as tabs, one editor for the open file. The files the
// exercise started with can't be removed (the tests depend on them); files
// the learner adds can. `readOnly` shows a set of files without editing.
export function ProjectEditor({
  language,
  files,
  onChange,
  keep = [],
  readOnly = false,
}: {
  language: CodeLanguage;
  files: ProjectFile[];
  onChange?: (files: ProjectFile[]) => void;
  // Names of files that can't be removed.
  keep?: string[];
  readOnly?: boolean;
}) {
  const [active, setActive] = useState(files[0]?.name ?? "");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  // The open file might have been removed or replaced by a reset.
  const current = files.find((f) => f.name === active) ?? files[0];
  const nameError = !name
    ? null
    : !isValidFileName(language, name)
      ? "Use a plain file name with the right extension."
      : files.some((f) => f.name.toLowerCase() === name.toLowerCase())
        ? "A file with that name exists."
        : null;

  function add() {
    if (!name || nameError || !onChange) return;
    onChange([...files, { name, content: "" }]);
    setActive(name);
    setName("");
    setAdding(false);
  }

  function remove(file: string) {
    if (!onChange) return;
    const rest = files.filter((f) => f.name !== file);
    onChange(rest);
    if (active === file) setActive(rest[0]?.name ?? "");
  }

  if (!current) return null;
  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="Project files" className="flex flex-wrap items-center gap-1">
        {files.map((f) => (
          <span key={f.name} className={cn("flex items-center rounded-md", f.name === current.name ? "bg-secondary" : "hover:bg-muted")}>
            <button
              role="tab"
              type="button"
              aria-selected={f.name === current.name}
              className="px-2 py-1 font-mono text-xs"
              onClick={() => setActive(f.name)}
            >
              {f.name}
            </button>
            {!readOnly && !keep.includes(f.name) && (
              <button type="button" aria-label={`Remove ${f.name}`} className="pr-1.5 text-muted-foreground hover:text-foreground" onClick={() => remove(f.name)}>
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && files.length < MAX_PROJECT_FILES && !adding && (
          <Button type="button" size="xs" variant="ghost" onClick={() => setAdding(true)}>
            <FilePlus2 className="size-3.5" />
            New file
          </Button>
        )}
      </div>
      {adding && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={60}
            aria-label="New file name"
            aria-invalid={!!nameError}
            placeholder={language === "cpp" ? "cache.hpp" : "Cache.cs"}
            className="h-8 w-48 font-mono text-xs"
            onChange={(e) => setName(e.target.value.trim())}
          />
          <Button type="submit" size="sm" disabled={!name || !!nameError}>
            Add
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => (setAdding(false), setName(""))}>
            Cancel
          </Button>
          {nameError && <span className="text-xs text-destructive">{nameError}</span>}
        </form>
      )}
      <CodeEditor
        key={current.name}
        language={language}
        value={current.content}
        readOnly={readOnly}
        minHeight={readOnly ? "4rem" : "12rem"}
        onChange={(content) => onChange?.(files.map((f) => (f.name === current.name ? { ...f, content } : f)))}
      />
    </div>
  );
}
