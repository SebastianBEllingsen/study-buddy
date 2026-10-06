import { describe, it, expect, vi } from "vitest";
import { importDeckCards, deckTitle } from "./importDeck";
import type { ImportedDeck } from "./apkgReader";

const deck: ImportedDeck = {
  name: "A::B",
  cards: [
    {
      front: { text: "q1", media: [{ type: "video", url: "https://x.test/v.mp4" }] },
      back: { text: "a1", media: [{ type: "image", file: "pic.png" }] },
    },
    {
      front: { text: "q2", media: [{ type: "image", file: "pic.png" }] },
      back: { text: "a2", media: [{ type: "audio", file: "missing.mp3" }, { type: "image", file: "x.exe" }] },
    },
  ],
};

describe("importDeckCards", () => {
  it("passes remote URLs through, stores each bundled file once, and skips what can't be stored", async () => {
    const readMedia = vi.fn(async (name: string) => (name === "pic.png" ? Buffer.from("png") : null));
    const store = vi.fn(async (key: string) => `/api/blobs/${key}`);

    const { cards, stats } = await importDeckCards(deck, { readMedia }, store);

    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0]).toMatch(/^anki\/[0-9a-f-]{36}\.png$/);
    const picUrl = cards[0].backMedia![0].src;
    expect(cards).toEqual([
      { front: "q1", back: "a1", frontMedia: [{ type: "video", src: "https://x.test/v.mp4" }], backMedia: [{ type: "image", src: picUrl }] },
      { front: "q2", back: "a2", frontMedia: [{ type: "image", src: picUrl }] },
    ]);
    // missing.mp3 isn't in the package; .exe isn't a media type we serve.
    expect(stats).toEqual({ cards: 2, mediaStored: 1, mediaSkipped: 2 });
    expect(readMedia).not.toHaveBeenCalledWith("x.exe");
  });

  it("drops a stored URL that isn't safe to render", async () => {
    const { cards, stats } = await importDeckCards(
      { name: "D", cards: [{ front: { text: "q", media: [{ type: "image", file: "p.png" }] }, back: { text: "a", media: [] } }] },
      { readMedia: async () => Buffer.from("x") },
      async () => "javascript:alert(1)"
    );
    expect(cards[0].frontMedia).toBeUndefined();
    expect(stats.mediaSkipped).toBe(1);
  });
});

describe("importDeckCards with rendered HTML", () => {
  const richDeck: ImportedDeck = {
    name: "R",
    styles: { "7": '@font-face{src:url("f.woff2")} .x{background:url(bg.png)} .y{background:url(https://x.test/r.png)}' },
    cards: [
      {
        front: { text: "q", media: [] },
        back: { text: "a", media: [] },
        html: {
          front: '<img src="pic.png"><a href="https://x.test">l</a>[sound:clip.mp3]',
          back: '<img src="missing.png"><img src="https://x.test/r.png">',
          style: "7",
          ordinal: 1,
        },
      },
    ],
  };
  const files = new Map<string, Buffer>([
    ["pic.png", Buffer.from("p")],
    ["clip.mp3", Buffer.from("c")],
    ["f.woff2", Buffer.from("f")],
    ["bg.png", Buffer.from("b")],
  ]);
  const run = () =>
    importDeckCards(richDeck, { readMedia: async (n) => files.get(n) ?? null }, async (key) => `/api/blobs/${key}`);

  it("points bundled files, [sound:] clips and stylesheet url()s at their stored copies", async () => {
    const { cards, styles } = await run();
    const html = cards[0].html!;
    expect(html.front).toMatch(/<img src="\/api\/blobs\/anki\/[0-9a-f-]{36}\.png">/);
    expect(html.front).toMatch(/<audio class="sb-sound" controls preload="metadata" src="\/api\/blobs\/anki\/[0-9a-f-]{36}\.mp3"><\/audio>/);
    expect(html.front).toContain('href="https://x.test"');
    expect(html.style).toBe("7");
    expect(styles["7"]).toMatch(/url\("\/api\/blobs\/anki\/[0-9a-f-]{36}\.woff2"\)/);
    expect(styles["7"]).toMatch(/url\("\/api\/blobs\/anki\/[0-9a-f-]{36}\.png"\)/);
    expect(styles["7"]).toContain("url(https://x.test/r.png)");
  });

  it("leaves references it can't resolve, and remote ones, as they are", async () => {
    const { cards } = await run();
    expect(cards[0].html!.back).toBe('<img src="missing.png"><img src="https://x.test/r.png">');
  });

  it("keeps the plain text copy alongside the HTML", async () => {
    const { cards } = await run();
    expect(cards[0].front).toBe("q");
    expect(cards[0].back).toBe("a");
  });

  it("returns no styles for a deck of plain cards", async () => {
    const { styles } = await importDeckCards(deck, { readMedia: async () => null }, async () => null);
    expect(styles).toEqual({});
  });
});

describe("deckTitle", () => {
  it("shows Anki's sub-deck path with arrows", () => {
    expect(deckTitle("Languages::Spanish")).toBe("Languages › Spanish");
  });
});
