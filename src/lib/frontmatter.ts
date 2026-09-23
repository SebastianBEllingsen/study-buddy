import yaml from "js-yaml";

// Obsidian "Properties": a YAML block fenced by --- lines at the very top of
// a note. Preview renders it as a key/value panel rather than as markdown
// (where the fences would read as <hr>s and the YAML as plain text/lists).

export type NoteProperties = Record<string, unknown>;

export interface SplitFrontmatter {
  // null when there's no frontmatter block, or its YAML doesn't parse to a
  // mapping — the caller then renders the source untouched, same as Obsidian
  // shows an invalid properties block as plain text.
  properties: NoteProperties | null;
  // Number of source lines the block occupies (fences included), 0 if none.
  lineCount: number;
  // The markdown after the block.
  body: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?^---[ \t]*(?:\r?\n|$)/m;

export function splitFrontmatter(markdown: string): SplitFrontmatter {
  const none = { properties: null, lineCount: 0, body: markdown };
  if (!markdown.startsWith("---")) return none;
  const m = FRONTMATTER_RE.exec(markdown);
  if (!m || m.index !== 0) return none;

  let parsed: unknown;
  try {
    // JSON_SCHEMA rather than the default: keeps dates like 2026-09-23 as
    // the string the user typed instead of turning them into Date objects.
    parsed = m[1].trim() === "" ? {} : yaml.load(m[1], { schema: yaml.JSON_SCHEMA });
  } catch {
    return none;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return none;

  const block = m[0];
  const lineCount = block.split("\n").length - (block.endsWith("\n") ? 1 : 0);
  return { properties: parsed as NoteProperties, lineCount, body: markdown.slice(block.length) };
}

// The same markdown with the frontmatter block's lines blanked out rather
// than removed — Preview's task checkboxes toggle by *source* line number,
// so keeping every later line where it was means no offset bookkeeping.
// Leading blank lines render as nothing.
export function blankFrontmatter(markdown: string): { properties: NoteProperties | null; markdown: string } {
  const { properties, lineCount, body } = splitFrontmatter(markdown);
  if (!properties) return { properties: null, markdown };
  return { properties, markdown: "\n".repeat(lineCount) + body };
}

// Display form of one property value: lists become arrays of strings (one
// chip each), scalars a single string. Nested objects fall back to compact
// JSON, since Obsidian doesn't render those as anything richer either.
export function formatPropertyValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(formatPropertyValue);
  if (typeof value === "object") return [JSON.stringify(value)];
  return [String(value)];
}
