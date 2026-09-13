import Linkify from "./Linkify";

// Renders pasted-text content with images embedded inline, Obsidian-style
// (see the "Paste text" dialog's image paste/drop support) — plain
// `![](data:image/...)` Markdown image syntax is the storage format (no
// separate image table; see schema.pg.ts's documents.extracted_text), split
// out here and rendered as real <img>s, with everything else still running
// through Linkify for clickable URLs exactly as before.
const IMAGE_MARKDOWN = /!\[[^\]]*\]\((data:image\/[^)]+)\)/g;

export default function PastedTextView({ text }: { text: string }) {
  const parts = text.split(IMAGE_MARKDOWN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL, not a next/image-optimizable asset
          <img key={i} src={part} alt="" className="my-2 block max-w-full rounded-md border" />
        ) : (
          <Linkify key={i} text={part} />
        )
      )}
    </>
  );
}
