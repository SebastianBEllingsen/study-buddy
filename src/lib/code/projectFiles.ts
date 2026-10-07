import type { CodeLanguage, ProjectFile } from "./types";

// Validation of the files of a multi-file project, for the AI's exercises
// and for what the learner sends to be run. Pure.

export const MAX_PROJECT_FILES = 12;
export const MAX_FILE_CHARS = 20_000;
export const MAX_PROJECT_CHARS = 80_000;

const EXTENSIONS: Partial<Record<CodeLanguage, readonly string[]>> = {
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".h"],
  csharp: [".cs"],
};

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}$/;

export function isValidFileName(language: CodeLanguage, name: unknown): name is string {
  if (typeof name !== "string" || !NAME.test(name) || name.includes("..")) return false;
  const lower = name.toLowerCase();
  return (EXTENSIONS[language] ?? []).some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

export function isHeader(name: string): boolean {
  return /\.(hpp|hh|h)$/i.test(name);
}

// Names the harness itself uses; a learner's file can't take their place.
const RESERVED = new Set(["prog.cpp", "prog.cs", "harness.cs", "harness.cpp", "fallback_main.cpp", "your_code.cpp", "your_code.cs"]);

// Cleans a list of files: valid unique names, text content, within limits.
// Returns null when anything is wrong, so a bad request is refused whole
// rather than half-run.
export function parseProjectFiles(language: CodeLanguage, raw: unknown, max = MAX_PROJECT_FILES): ProjectFile[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
  const files: ProjectFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { name, content } = entry as Record<string, unknown>;
    if (!isValidFileName(language, name) || typeof content !== "string") return null;
    const key = name.toLowerCase();
    if (seen.has(key) || RESERVED.has(key) || content.length > MAX_FILE_CHARS) return null;
    seen.add(key);
    total += content.length;
    files.push({ name, content: content.replace(/\r\n/g, "\n") });
  }
  return total > MAX_PROJECT_CHARS ? null : files;
}

// The files as one text, for reviews and the practice question's model
// answer: each under a comment naming it.
export function joinFiles(files: ProjectFile[], language: CodeLanguage): string {
  const mark = language === "sql" ? "--" : "//";
  return files.map((f) => `${mark} ${f.name}\n${f.content.trimEnd()}`).join("\n\n");
}
