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

describe("deckTitle", () => {
  it("shows Anki's sub-deck path with arrows", () => {
    expect(deckTitle("Languages::Spanish")).toBe("Languages › Spanish");
  });
});
