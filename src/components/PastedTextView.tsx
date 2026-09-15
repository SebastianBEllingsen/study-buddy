import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import Linkify from "./Linkify";

// Renders pasted-text content with images embedded inline, Obsidian-style
// (see the "Paste text" dialog's image paste/drop support) — plain
// `![](data:image/...)` Markdown image syntax is the storage format (no
// separate image table; see schema.pg.ts's documents.extracted_text), split
// out here and rendered as real <img>s, with everything else still running
// through Linkify for clickable URLs exactly as before.
const IMAGE_MARKDOWN = /!\[[^\]]*\]\((data:image\/[^)]+)\)/g;

// react-markdown's default urlTransform allow-lists only http(s)/irc(s)/
// mailto/xmpp and strips everything else — without this override, every
// embedded image (a real data:image/... URL, not a URL a browser would
// navigate to) would get its src silently dropped. Scoped to image data
// URLs specifically, not data: URIs in general.
const allowDataImages = (url: string) => (url.startsWith("data:image/") ? url : defaultUrlTransform(url));

// A pasted-text document that's been through "Make pretty" (see
// lib/tidyText.ts) is real Markdown, LaTeX included — this renders it
// exactly the way a note's own Preview does (same plugin set, same
// markdown-body styling), rather than showing the raw "**bold**"/"$x$"
// source as literal text.
function MarkdownPastedText({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={allowDataImages}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Plain-text rendering — used for a real PDF's extracted text (shown when
// the original file isn't on this device), which is raw OCR/extraction
// output rather than intentional Markdown, so parsing it as such would risk
// misreading incidental "*"/"#" characters as formatting.
function PlainPastedText({ text }: { text: string }) {
  const parts = text.split(IMAGE_MARKDOWN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL, not a next/image-optimizable asset
          <img key={i} src={part} alt="" className="my-2 block max-w-full rounded-md border" />
        ) : (
          <Linkify key={i} text={part} />
        )
      )}
    </>
  );
}

export default function PastedTextView({ text, markdown = false }: { text: string; markdown?: boolean }) {
  return markdown ? <MarkdownPastedText text={text} /> : <PlainPastedText text={text} />;
}
