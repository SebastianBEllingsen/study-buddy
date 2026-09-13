// Turns bare URLs in plain text into clickable links — used where content
// renders as raw text rather than Markdown (pasted documents and the
// extracted-text fallback view), which otherwise show a URL as inert text.
const URL_PATTERN = /(https?:\/\/[^\s<>"')]+)/g;

export default function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}
