import { NOTE_IMAGE_SCHEME } from "@/lib/noteImages";

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

// The edits that move one embedded picture (see NoteEditor's image drag) to
// its own line at `insertAt` (a line start). Only the ![...](...) itself
// moves — a picture pasted at the end of a sentence leaves the sentence
// where it was, along with one of the spaces around it; a picture alone on
// its line takes the whole line with it. Changes are in the original
// document's coordinates, as CodeMirror expects for a simultaneous set.
// Null when there's nothing to do: the picture isn't in the document any
// more, or it was dropped onto its own line.
export function noteImageMoveChanges(doc: string, imageId: number, insertAt: number): TextChange[] | null {
  const re = new RegExp(`!\\[[^\\]\\n]*\\]\\(${NOTE_IMAGE_SCHEME}${imageId}\\)`);
  const match = re.exec(doc);
  if (!match) return null;
  const refFrom = match.index;
  const refTo = refFrom + match[0].length;

  const lineFrom = doc.lastIndexOf("\n", refFrom - 1) + 1;
  const newline = doc.indexOf("\n", refTo);
  const lineTo = newline === -1 ? doc.length : newline;
  if (insertAt === lineFrom) return null;

  let from = refFrom;
  let to = refTo;
  if ((doc.slice(lineFrom, refFrom) + doc.slice(refTo, lineTo)).trim() === "") {
    // Alone on its line: remove the line and one of the newlines around it.
    from = lineFrom;
    to = lineTo;
    if (to < doc.length) to += 1;
    else if (from > 0) from -= 1;
  } else if (doc[from - 1] === " ") {
    from -= 1;
  } else if (doc[to] === " ") {
    to += 1;
  }
  if (insertAt > from && insertAt < to) return null;

  return [
    { from, to, insert: "" },
    { from: insertAt, to: insertAt, insert: `${match[0]}\n` },
  ];
}
