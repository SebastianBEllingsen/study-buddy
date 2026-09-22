// A GFM task-list marker at the start of a list item: an unordered bullet
// (-, *, +) or ordered marker (1., 1)) followed by "[ ]"/"[x]" — the same
// shape remark-gfm (the Vault's Preview mode) and @lezer/markdown's GFM
// extension (Edit mode, via the CodeMirror TaskMarker syntax node) both
// recognize as a checkable item.
const TASK_MARKER_RE = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;

// Flips the checked state of the task marker on a given (0-indexed) line.
// Preview mode gets its line number from react-markdown's own node.position
// (stable and pure — always the source line, no matter how many times React
// happens to call a component's render, unlike a call-count-based ordinal
// would be under React's dev-mode double-invoking of render). Returns the
// document unchanged if that line doesn't exist or isn't a task marker.
export function toggleTaskMarkerAtLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return markdown;
  const match = line.match(TASK_MARKER_RE);
  if (!match) return markdown;
  const checked = match[2].toLowerCase() === "x";
  lines[lineIndex] = match[1] + (checked ? "[ ]" : "[x]") + line.slice(match[0].length);
  return lines.join("\n");
}
