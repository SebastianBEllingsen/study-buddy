import type { CardHtml, Flashcard, FlashcardsContent } from "./types";

// Cards imported from Anki keep the HTML their note type renders (see
// CardHtml) and are drawn in a sandboxed frame, so templates that use
// scripts, styling or layout — the things a plain-text card can't hold —
// behave as they do in Anki.

// Attaches the note type's stylesheet to a card's HTML. Cards without HTML
// (everything not imported from Anki, and decks imported before this
// existed) come back unchanged.
export function withCardCss(card: Flashcard, styles: FlashcardsContent["styles"]): Flashcard {
  if (!card.html) return card;
  const css = card.html.style ? styles?.[card.html.style] : undefined;
  return css === undefined ? card : { ...card, html: { ...card.html, css } };
}

export function hasCardHtml(card: Flashcard, reverse: boolean): card is Flashcard & { html: CardHtml } {
  // A back-first turn asks with the answer's text, which a rendered card
  // can't be turned inside out for — it uses the plain-text faces.
  return !!card.html && !reverse;
}

export type CardFrameMessage =
  | { sb: string; kind: "height"; height: number }
  | { sb: string; kind: "flip" }
  | { sb: string; kind: "key"; key: string; code: string };

export interface CardDocumentOptions {
  html: string;
  css: string;
  side: "front" | "back";
  ordinal: number;
  dark: boolean;
  textColor: string;
  // Origin the app's own media is served from; the frame may load files
  // from its blob route and nothing else on it.
  origin: string;
  // Random per frame, so the parent can tell its own frame's messages apart.
  channel: string;
  autoplay: boolean;
  // Play every clip in turn rather than just the first (the app's "Card
  // audio" setting, lib/audioAutoplay.ts).
  sequence?: boolean;
}

// The frame blocks every way a card's script could talk to the network
// other than loading media/fonts/styles: no fetch/XHR/WebSocket, forms or
// nested frames. Media may come from any https/http origin (decks link
// remote clips) or this app's own blob route.
export function cardContentSecurityPolicy(origin: string): string {
  const blobs = `${origin}/api/blobs/`;
  const katex = `${origin}/api/vendor/katex/`;
  const media = `${blobs} ${katex} https: http: data: blob:`;
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${blobs} ${katex} https:`,
    `style-src 'unsafe-inline' ${blobs} ${katex} https:`,
    `img-src ${media}`,
    `media-src ${media}`,
    `font-src ${media}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

// The keys a card frame may press on the page's behalf: the review
// shortcuts only (space flips, 1–4 rate). The frame's own script already
// filters to these, but a deck's own script can post any message it likes,
// so the page filters again — a card can't type other shortcuts (search,
// settings, …) into the app. The code is derived here, never taken from the
// frame.
const FRAME_KEYS: Record<string, string> = { " ": "Space", Enter: "Enter", "1": "Digit1", "2": "Digit2", "3": "Digit3", "4": "Digit4" };

export function frameKeyPress(key: unknown): { key: string; code: string } | null {
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(FRAME_KEYS, key)) return null;
  return { key, code: FRAME_KEYS[key] };
}

const FRAME_SCRIPT = `
(function () {
  var channel = __CHANNEL__;
  function send(m) { m.sb = channel; parent.postMessage(m, "*"); }
  var last = 0;
  function measure() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (h !== last) { last = h; send({ kind: "height", height: h }); }
  }
  var playRun = 0;
  function clips() { return Array.prototype.slice.call(document.querySelectorAll("audio[autoplay], audio.sb-sound, video[autoplay]")); }
  function playFrom(list, i, run) {
    var el = list[i];
    if (!el || !el.play || run !== playRun) return;
    if (__SEQUENCE__) el.onended = function () { playFrom(list, i + 1, run); };
    var p = el.play();
    if (p && p.catch) p.catch(function () {});
  }
  function playFirst() { playRun++; playFrom(clips(), 0, playRun); }
  function stopAll() {
    playRun++;
    document.querySelectorAll("audio, video").forEach(function (m) { try { m.pause(); } catch (e) {} });
  }
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.sb !== channel) return;
    if (e.data.kind === "active") { if (e.data.value) playFirst(); else stopAll(); }
  });
  window.addEventListener("load", function () {
    measure();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(document.documentElement);
    setInterval(measure, 500);
    if (__AUTOPLAY__) playFirst();
  });
  var KEYS = { " ": 1, Enter: 1, "1": 1, "2": 1, "3": 1, "4": 1 };
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!KEYS[e.key]) return;
    e.preventDefault();
    send({ kind: "key", key: e.key, code: e.code });
  });
  var INTERACTIVE = "a,button,input,select,textarea,summary,details,audio,video,label,[onclick],[contenteditable]";
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(INTERACTIVE)) return;
    if (window.getSelection && String(window.getSelection()).trim()) return;
    send({ kind: "flip" });
  });
})();
`;

// Anki's stock card style paints every card white with black text, and Anki
// itself recolours it in night mode. A deck that kept the stock colours gets
// the same treatment here — on the page's own background with the page's
// text colour — instead of a white sheet on a dark app. Decks that chose
// their own colours (including a night-mode style) are left as they are.
export function adaptStockCardCss(css: string): string {
  return css.replace(/\.card\s*\{[^}]*\}/g, (rule) =>
    rule
      .replace(/(background(?:-color)?\s*:\s*)(?:white|#fff(?:fff)?)\s*(;|\})/gi, "$1transparent$2")
      .replace(/(^|[;{\s])color\s*:\s*(?:black|#000(?:000)?)\s*(;|\})/gi, "$1color: inherit$2")
  );
}

// A complete document for one side of a card: the deck's own CSS and HTML
// inside Anki's usual wrappers (body.card, #qa, night-mode classes), with a
// small script that reports the content height, forwards flip/rating keys
// and handles autoplay for the parent.
export function buildCardDocument(o: CardDocumentOptions): string {
  // Clips written by earlier imports were saved with preload="none", which
  // shows an empty 0:00 player until played.
  const html = o.html.replace(/(<(?:audio|video) class="sb-sound" controls) preload="none"/g, '$1 preload="metadata"');
  const script = FRAME_SCRIPT.replace("__CHANNEL__", JSON.stringify(o.channel)).replace(
    "__AUTOPLAY__",
    o.autoplay ? "true" : "false"
  ).replace("__SEQUENCE__", o.sequence ? "true" : "false");
  // Anki typesets \(…\) and \[…\] itself; this frame does the same with
  // KaTeX, loaded from the app, only for cards that contain math.
  const hasMath = /\\\(|\\\[/.test(html);
  const katexHead = hasMath
    ? `<link rel="stylesheet" href="${o.origin}/api/vendor/katex/katex.min.css">
<script src="${o.origin}/api/vendor/katex/katex.min.js"></script>
<script src="${o.origin}/api/vendor/katex/contrib/auto-render.min.js"></script>`
    : "";
  const katexRun = hasMath
    ? `window.addEventListener("load",function(){if(window.renderMathInElement)renderMathInElement(document.body,{throwOnError:false,delimiters:[{left:"\\\\(",right:"\\\\)",display:false},{left:"\\\\[",right:"\\\\]",display:true},{left:"$$",right:"$$",display:true}]})});`
    : "";
  const bodyClass = ["card", `card${o.ordinal}`, ...(o.dark ? ["nightMode", "night_mode"] : [])].join(" ");
  const htmlClass = o.dark ? ' class="night-mode"' : "";
  // The frame's colour scheme must match the page it sits in: a frame whose
  // scheme differs gets an opaque white backdrop from the browser, which is
  // what turns a deck's transparent card into a white box on a dark page.
  const scheme = o.dark ? "dark" : "light";
  const css = o.dark ? adaptStockCardCss(o.css) : o.css;
  const base = `html{color-scheme:${scheme};overflow:hidden}html,body{margin:0;background:transparent}body{padding:4px 12px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:20px;text-align:center;overflow-wrap:anywhere;color:${o.textColor}}img,video{max-width:100%}`;
  return `<!doctype html>
<html${htmlClass}><head><meta charset="utf-8">
<meta name="color-scheme" content="${scheme}">
<meta http-equiv="Content-Security-Policy" content="${cardContentSecurityPolicy(o.origin).replace(/"/g, "&quot;")}">
<base target="_blank">
${katexHead}
<style>${base}</style>
<style>${css.replace(/<\/style/gi, "<\\/style")}</style>
</head><body class="${bodyClass}"><div id="qa">${html}</div>
<script>${(katexRun + script).replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`;
}
