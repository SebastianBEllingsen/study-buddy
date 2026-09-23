// Turns one Anki card into a Study Buddy flashcard face pair: renders the
// note type's front/back templates the way Anki does (field substitution,
// {{#conditional}} sections, cloze deletions), then reduces the resulting
// HTML to plain text plus a list of media clips — FlashcardViewer renders
// text through MathText, not arbitrary HTML.
//
// Rendering the template (instead of just listing which fields it names)
// matters for note types whose front is e.g. `<video src="{{Video}}">`: the
// Video field alone is a bare URL, and only the rendered template says it's
// meant to be played as a video.

import type { CardMediaType } from "@/lib/types";

// A media reference found in a rendered card: either a remote URL, or a
// filename inside the .apkg's own media bundle.
export type ImportedMedia = { type: CardMediaType } & ({ url: string } | { file: string });

export interface CardFaceContent {
  text: string;
  media: ImportedMedia[];
}

export interface RenderContext {
  fields: Record<string, string>;
  // 1-based cloze number this card shows, for cloze note types.
  clozeOrdinal?: number;
  // Values for Anki's built-in pseudo-fields.
  tags?: string;
  deck?: string;
  cardName?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  rarr: "→",
  larr: "←",
  times: "×",
  divide: "÷",
  deg: "°",
  middot: "·",
  bull: "•",
  copy: "©",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  aring: "å",
  Aring: "Å",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name] ?? whole;
  });
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

function renderCloze(text: string, ordinal: number | undefined, side: "front" | "back"): string {
  return text.replace(CLOZE, (_, n: string, answer: string, hint?: string) => {
    if (Number(n) !== ordinal) return answer;
    return side === "front" ? `[${hint ?? "…"}]` : answer;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// Anki template syntax: {{Field}}, {{filter:Field}}, {{#Field}}…{{/Field}},
// {{^Field}}…{{/Field}}, and pseudo-fields like {{Tags}}/{{Deck}}.
export function renderTemplate(template: string, side: "front" | "back", ctx: RenderContext): string {
  const value = (name: string): string => {
    switch (name) {
      case "Tags":
        return ctx.tags ?? "";
      case "Deck":
        return ctx.deck ?? "";
      case "Subdeck":
        return ctx.deck?.split("::").pop() ?? "";
      case "Card":
        return ctx.cardName ?? "";
      case "FrontSide":
        // Study Buddy shows the back face on its own, so the back never
        // repeats the front's text (media is carried over separately).
        return "";
    }
    return ctx.fields[name] ?? "";
  };
  const isEmpty = (name: string) => stripTags(value(name)).trim() === "" && !/<(img|video|audio)\b/i.test(value(name));

  // Sections, innermost first, until none are left.
  let out = template;
  const section = /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/;
  for (let guard = 0; guard < 100 && section.test(out); guard++) {
    out = out.replace(section, (_, kind: string, name: string, body: string) =>
      (kind === "#") !== isEmpty(name) ? body : ""
    );
  }

  return out.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, ref: string) => {
    const parts = ref.split(":").map((p) => p.trim());
    const name = parts.pop()!;
    const filters = parts;
    if (filters.some((f) => f === "type" || f.startsWith("tts"))) {
      // A type-in-the-answer box on the front; the expected answer on the back.
      return filters.includes("type") && side === "back" ? value(name) : "";
    }
    let v = value(name);
    if (filters.includes("cloze")) v = renderCloze(v, ctx.clozeOrdinal, side);
    if (filters.includes("text")) v = stripTags(v);
    return v;
  });
}

// Placeholder for a block-element boundary while flattening HTML — a
// character that can't occur in field text.
const BLOCK = "\u0000";

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|mkv|ogv)$/i;

function mediaRef(type: CardMediaType, raw: string): ImportedMedia | null {
  const src = decodeEntities(raw).trim();
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return { type, url: src };
  // Anything else with a scheme (data:, javascript:, file:, …) is dropped;
  // a bare name refers to a file in the package's media bundle.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  return { type, file: src };
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

// Rendered card HTML → plain text (with $…$ math) + media clips, in order.
export function htmlToCardFace(html: string): CardFaceContent {
  const media: ImportedMedia[] = [];
  const add = (m: ImportedMedia | null) => {
    if (!m) return;
    const key = "url" in m ? m.url : m.file;
    if (!media.some((x) => ("url" in x ? x.url : x.file) === key)) media.push(m);
  };

  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|canvas|template)\b[\s\S]*?<\/\1>/gi, "");

  s = s.replace(/<(video|audio)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_, tag: string, attrs: string, inner: string) => {
    const type = tag.toLowerCase() as CardMediaType;
    const src = attr(attrs, "src") ?? inner.match(/<source\b[^>]*>/i)?.[0].match(/\ssrc\s*=\s*"([^"]*)"/i)?.[1];
    if (src) add(mediaRef(type, src));
    return BLOCK;
  });
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, "src");
    if (src) add(mediaRef("image", src));
    return "";
  });
  s = s.replace(/\[sound:([^\]]+)\]/g, (_, file: string) => {
    add(mediaRef(VIDEO_EXTENSIONS.test(file) ? "video" : "audio", file));
    return "";
  });

  // As in HTML, source newlines/indentation are just whitespace. Each <br>
  // is one line break; block elements mark a boundary, and any run of
  // boundaries (</div><div>, nested blocks) is a single break, the way a
  // browser lays them out.
  s = s
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, `${BLOCK}• `)
    .replace(/<\/?(div|p|li|ul|ol|h[1-6]|tr|table|blockquote|pre|hr)\b[^>]*>/gi, BLOCK);
  s = decodeEntities(stripTags(s)).replace(/[ \t]*\u0000[\u0000 \t]*/g, "\n");

  // Anki's MathJax delimiters → the $…$ / $$…$$ MathText understands.
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => `$$${tex}$$`);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex: string) => `$${tex}$`);

  const text = s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, media };
}

// The part of a back template after Anki's answer divider — what's new on
// the back — or the whole thing when there's no divider.
export function answerPart(renderedBack: string): string {
  const m = renderedBack.match(/<hr\s+id\s*=\s*["']?answer["']?\s*\/?>/i);
  return m ? renderedBack.slice(m.index! + m[0].length) : renderedBack;
}
