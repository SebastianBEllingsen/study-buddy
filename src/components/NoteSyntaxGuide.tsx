import type { ReactNode } from "react";
import { CALLOUT_ALIASES, CALLOUT_TYPES } from "@/lib/callouts";

// The full reference of what notes understand — shown in the note header's
// (?) hover box and in its detached window (/help/note-syntax). Colors are
// all relative (currentColor/opacity), since the hover box is the inverted
// tooltip style and the detached window the normal page style. Keep in sync
// with what NoteMarkdown/NoteEditor actually render.

type Row = [syntax: string, meaning: ReactNode];

const SECTIONS: { title: string; rows: Row[]; note?: ReactNode }[] = [
  {
    title: "Text",
    rows: [
      ["**bold**  __bold__", "Bold"],
      ["*italic*  _italic_", "Italic"],
      ["***bold italic***", "Both"],
      ["~~strike~~", "Strikethrough"],
      ["`code`", "Inline code"],
      ["\\*not italic\\*", "Backslash shows a character literally"],
      ["---", "Horizontal rule (on its own line)"],
    ],
    note: "Enter starts a new line; a blank line starts a new paragraph.",
  },
  {
    title: "Headings",
    rows: [
      ["# Heading 1", "Largest"],
      ["###### Heading 6", "Smallest"],
    ],
  },
  {
    title: "Lists",
    rows: [
      ["- item  * item  + item", "Bulleted list"],
      ["1. item", "Numbered list"],
      ["  - nested", "Indent to nest"],
      ["- [ ] task", "Open task, clickable in Preview"],
      ["- [x] task", "Done task"],
    ],
  },
  {
    title: "Quotes & callouts",
    rows: [
      ["> quote", "Blockquote"],
      ["> [!tip] Title\n> Body text", "Callout with a title and body"],
      ["> [!tip]", "No title: the type name is used"],
      ["> [!tip]-", "Foldable, starts collapsed"],
      ["> [!tip]+", "Foldable, starts open"],
      ["> [!note]\n> > [!tip]", "Callouts nest"],
    ],
    note: "Anything unrecognized gets note styling but keeps your title.",
  },
  {
    title: "Code",
    rows: [
      ["```python\ncode\n```", "Code block with syntax highlighting"],
      ["~~~\ncode\n~~~", "Code block, tilde fence"],
    ],
  },
  {
    title: "Math (LaTeX)",
    rows: [
      ["$x^2$", "Inline math"],
      ["$$\n\\int_0^1 x\\,dx\n$$", "Block math"],
      ["\\fr", "Typing \\ suggests LaTeX commands"],
    ],
  },
  {
    title: "Tables",
    rows: [
      ["| A | B |\n| --- | --- |\n| 1 | 2 |", "Header, divider, rows"],
      ["| :-- | :-: | --: |", "Align left, center, right"],
    ],
    note: "Tab / Shift-Tab move between cells; Tab in the last cell adds a row.",
  },
  {
    title: "Links",
    rows: [
      ["[[", "Pick a note to link"],
      ["[[Title]]", "Link a note by name"],
      ["[[Title|shown text]]", "Link with different text"],
      ["[[Title#Heading]]", "Link to a heading in a note"],
      ["[[#Heading]]", "Link to a heading in this note"],
      ["[text](https://…)", "Web link; Ctrl-click opens it while editing"],
      ["https://…", "Bare URLs become links"],
    ],
    note: "A link to a note that doesn't exist yet creates it when clicked. Use Insert link in the toolbar for documents and generated items.",
  },
  {
    title: "Media",
    rows: [
      ["Paste / drop an image", "Adds it to the note; drag it to move it"],
      ["![alt](https://…/pic.png)", "Image from the web (Preview)"],
      ["![](youtube link)", "Embedded video; ?t=90 or t=1m30s starts there"],
    ],
  },
  {
    title: "Footnotes",
    rows: [
      ["Text[^1]", "Footnote reference"],
      ["[^1]: The note", "Footnote text, listed at the bottom"],
    ],
  },
  {
    title: "Properties",
    rows: [["---\ntags: [exam, week3]\ndue: 2026-10-01\n---", "YAML at the very top of the note"]],
    note: "tags show as #chips; any list shows as chips.",
  },
];

function Syntax({ children }: { children: string }) {
  return <code className="rounded bg-current/10 px-1 py-px font-mono whitespace-pre">{children}</code>;
}

export default function NoteSyntaxGuide() {
  const aliasesByType = new Map<string, string[]>();
  for (const [alias, type] of Object.entries(CALLOUT_ALIASES)) {
    aliasesByType.set(type, [...(aliasesByType.get(type) ?? []), alias]);
  }

  return (
    <div className="space-y-3">
      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h3 className="mb-1 font-semibold">{section.title}</h3>
          <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1">
            {section.rows.map(([syntax, meaning]) => (
              <div key={syntax} className="contents">
                <Syntax>{syntax}</Syntax>
                <span className="opacity-80">{meaning}</span>
              </div>
            ))}
          </div>
          {section.note && <p className="mt-1 opacity-70">{section.note}</p>}

          {section.title === "Quotes & callouts" && (
            <div className="mt-2">
              <p className="mb-1 opacity-80">
                Callout types (write any in place of <Syntax>tip</Syntax>, aliases in grey):
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {CALLOUT_TYPES.map((type) => (
                  <div key={type} className="contents">
                    <span data-callout={type} className="font-mono font-medium" style={{ color: "rgb(var(--callout-color))" }}>
                      {type}
                    </span>
                    <span className="font-mono opacity-60">{(aliasesByType.get(type) ?? []).join(", ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
