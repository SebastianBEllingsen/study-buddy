import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { flashcardsToApkg, textToFieldHtml, type LoadLocalMedia } from "./exportDeck";
import { readApkg } from "./apkgReader";
import { importDeckCards } from "./importDeck";
import type { Flashcard } from "@/lib/types";

const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");

const loadLocalMedia: LoadLocalMedia = async (src) =>
  src === "/api/blobs/anki/pic.png" ? { bytes: PNG, ext: ".png" } : null;

describe("textToFieldHtml", () => {
  it("escapes HTML, keeps line breaks, and converts $ math to Anki's MathJax delimiters", () => {
    expect(textToFieldHtml("a < b & c\n$x^2$ and $$\\frac{1}{2}$$")).toBe(
      "a &lt; b &amp; c<br>\\(x^2\\) and \\[\\frac{1}{2}\\]"
    );
  });
});

describe("flashcardsToApkg", () => {
  const cards: Flashcard[] = [
    { front: "What is $x^2$ at 3?", back: "9\nbecause 3·3" },
    {
      front: "",
      back: "verde",
      frontMedia: [{ type: "video", src: "https://x.test/video/green.mp4" }],
      backMedia: [{ type: "image", src: "/api/blobs/anki/pic.png" }],
    },
  ];

  it("round-trips through the importer: same text, remote media linked, local media bundled", async () => {
    const apkg = await flashcardsToApkg({ itemId: 7, deckName: "Languages::Spanish", cards, loadLocalMedia });
    const contents = await readApkg(apkg);
    expect(contents.decks.map((d) => d.name)).toEqual(["Languages::Spanish"]);

    const stored: Buffer[] = [];
    const { cards: back } = await importDeckCards(contents.decks[0], contents, async (key, bytes) => {
      stored.push(bytes);
      return `/api/blobs/${key}`;
    });
    expect(back[0]).toEqual({ front: "What is $x^2$ at 3?", back: "9\nbecause 3·3" });
    expect(back[1].front).toBe("");
    expect(back[1].back).toBe("verde");
    expect(back[1].frontMedia).toEqual(cards[1].frontMedia);
    expect(back[1].backMedia).toEqual([{ type: "image", src: expect.stringMatching(/^\/api\/blobs\/anki\/.+\.png$/) }]);
    expect(stored).toEqual([PNG]);
  });

  it("gives each card a stable guid, so re-exporting updates rather than duplicates", async () => {
    const guids = async (itemId: number) => {
      const zip = await JSZip.loadAsync(await flashcardsToApkg({ itemId, deckName: "D", cards, loadLocalMedia }));
      const db = new Database(await zip.file("collection.anki2")!.async("nodebuffer"));
      try {
        return (db.prepare("SELECT guid FROM notes ORDER BY id").all() as { guid: string }[]).map((r) => r.guid);
      } finally {
        db.close();
      }
    };
    const first = await guids(7);
    expect(new Set(first).size).toBe(2);
    expect(await guids(7)).toEqual(first);
    expect(await guids(8)).not.toEqual(first);
  });
});
