// A short plain-text preview of a note's markdown, for lists like the
// dashboard's Pinned notes widget: markup characters and link syntax are
// dropped, whitespace is collapsed, and long text is cut with an ellipsis.
export function noteSnippet(markdown: string, max = 140): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    // [[note:12|label]] / [[Title]] -> the visible label or title
    .replace(/\[\[(?:[^\]|]*\|)?([^\]#]*)[^\]]*\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}
