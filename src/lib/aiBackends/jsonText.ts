// Models sometimes wrap JSON in markdown code fences despite instructions
// not to; strip them defensively before parsing rather than failing/retrying
// on a purely cosmetic mismatch.
export function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

// Looser than JSON.parse(stripCodeFences(text)), for responses that can't
// be forced into a JSON mode — a web-search-grounded answer (Gemini can't
// combine search grounding with JSON mode; search-augmented Claude may add a
// sentence before or after). Falls back to the outermost {...} span when the
// whole text isn't JSON. Throws SyntaxError when nothing parses.
export function parseJsonFromText<T>(text: string): T {
  const candidate = stripCodeFences(text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch (err) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw err;
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  }
}
