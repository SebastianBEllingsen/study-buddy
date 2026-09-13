import katex from "katex";
import { MATH_PATTERN } from "@/lib/mathSanitizer";

// Splits on $$...$$ (display) first, then $...$ (inline, no line breaks
// inside — same heuristic remark-math uses for single-dollar math), leaving
// everything else as plain text. A drop-in replacement for rendering a
// plain string directly, for places (quiz questions, flashcard fronts/backs)
// that don't otherwise need markdown — just occasional math spans in text.

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch {
    return tex;
  }
}

export function MathText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(MATH_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    const [full, display, inline] = match;
    const tex = display ?? inline ?? "";
    parts.push(
      <span
        key={key++}
        dangerouslySetInnerHTML={{ __html: renderMath(tex, display !== undefined) }}
      />
    );
    lastIndex = index + full.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts.length > 0 ? parts : text}</>;
}
