import { describe, it, expect } from "vitest";
import { adaptStockCardCss, buildCardDocument, cardContentSecurityPolicy, hasCardHtml, withCardCss } from "./cardHtml";
import type { Flashcard } from "./types";

const options = {
  html: "<p>Bonjour</p>",
  css: ".card { color: red; }",
  side: "front" as const,
  ordinal: 1,
  dark: false,
  textColor: "#111",
  origin: "http://localhost:3000",
  channel: "chan-1",
  autoplay: true,
};

describe("withCardCss", () => {
  const card: Flashcard = { front: "a", back: "b", html: { front: "<p>a</p>", back: "<p>b</p>", style: "7" } };

  it("attaches the note type's stylesheet", () => {
    expect(withCardCss(card, { "7": ".card{}" }).html?.css).toBe(".card{}");
  });

  it("leaves cards without HTML, or without a matching stylesheet, as they are", () => {
    const plain: Flashcard = { front: "a", back: "b" };
    expect(withCardCss(plain, { "7": "x" })).toBe(plain);
    expect(withCardCss(card, undefined)).toBe(card);
  });
});

describe("hasCardHtml", () => {
  it("uses the rendered card only for the regular direction", () => {
    const card: Flashcard = { front: "a", back: "b", html: { front: "f", back: "b" } };
    expect(hasCardHtml(card, false)).toBe(true);
    expect(hasCardHtml(card, true)).toBe(false);
    expect(hasCardHtml({ front: "a", back: "b" }, false)).toBe(false);
  });
});

describe("cardContentSecurityPolicy", () => {
  it("blocks network requests and nested frames, allowing media only from remote hosts and the app's blob route", () => {
    const csp = cardContentSecurityPolicy("http://localhost:3000");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("img-src http://localhost:3000/api/blobs/");
    // The rest of the app's origin is not loadable from a card.
    expect(csp).not.toMatch(/\shttp:\/\/localhost:3000(\s|;|$)/);
  });
});

describe("adaptStockCardCss", () => {
  it("makes Anki's stock white-on-black card style follow the page", () => {
    const stock = ".card {\n  font-family: arial;\n  font-size: 20px;\n  text-align: center;\n  color: black;\n  background-color: white;\n}";
    const out = adaptStockCardCss(stock);
    expect(out).toContain("background-color: transparent");
    expect(out).toContain("color: inherit");
    expect(out).toContain("font-family: arial");
  });

  it("leaves a deck's own colours alone", () => {
    const own = ".card { color: #222; background-color: #fcfcfc; } .other { color: black; }";
    expect(adaptStockCardCss(own)).toBe(own);
  });
});

describe("buildCardDocument", () => {
  it("wraps the card in Anki's body classes with the deck's own CSS", () => {
    const doc = buildCardDocument(options);
    expect(doc).toContain('<body class="card card1">');
    expect(doc).toContain('<div id="qa"><p>Bonjour</p></div>');
    expect(doc).toContain(".card { color: red; }");
    expect(doc).toContain('Content-Security-Policy');
  });

  it("marks night mode on both the page and the body", () => {
    const doc = buildCardDocument({ ...options, dark: true });
    expect(doc).toContain('<html class="night-mode">');
    expect(doc).toContain("nightMode night_mode");
  });

  it("matches the frame's colour scheme to the page, so the browser doesn't paint it white", () => {
    expect(buildCardDocument(options)).toContain("html{color-scheme:light;overflow:hidden}");
    const dark = buildCardDocument({ ...options, dark: true });
    expect(dark).toContain("html{color-scheme:dark;overflow:hidden}");
    expect(dark).toContain('<meta name="color-scheme" content="dark">');
  });

  it("never scrolls inside the frame — the frame is sized to the card", () => {
    expect(buildCardDocument(options)).toContain("overflow:hidden");
  });

  it("upgrades a clip saved with preload=none so its length shows", () => {
    const doc = buildCardDocument({ ...options, html: '<audio class="sb-sound" controls preload="none" src="/a.mp3"></audio>' });
    expect(doc).toContain('controls preload="metadata"');
    expect(doc).not.toContain('preload="none"');
  });

  it("only loads KaTeX for cards with math", () => {
    expect(buildCardDocument(options)).not.toContain("katex.min.js");
    expect(buildCardDocument({ ...options, html: "<p>\\(x^2\\)</p>" })).toContain("/api/vendor/katex/katex.min.js");
  });

  it("can't be broken out of by a stylesheet or script containing a closing tag", () => {
    const doc = buildCardDocument({ ...options, css: "</style><img src=x onerror=1>" });
    expect(doc).not.toContain("</style><img");
  });

  it("plays every clip in turn only when asked", () => {
    expect(buildCardDocument({ ...options, sequence: true })).toContain("if (true) el.onended");
    expect(buildCardDocument(options)).toContain("if (false) el.onended");
  });

  it("sets the autoplay flag and channel for the frame script", () => {
    expect(buildCardDocument(options)).toContain('var channel = "chan-1"');
    expect(buildCardDocument(options)).toContain("if (true) playFirst()");
    expect(buildCardDocument({ ...options, autoplay: false })).toContain("if (false) playFirst()");
  });
});
