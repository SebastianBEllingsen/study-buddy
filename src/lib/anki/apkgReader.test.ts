import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { readApkg, readProto, ApkgFormatError } from "./apkgReader";
import { writeApkg, stableId, type AnkiNoteType } from "./apkgWriter";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name));

describe.each([
  ["modern (collection.anki21b)", "anki-26-modern.apkg"],
  ["legacy (collection.anki21)", "anki-26-legacy.apkg"],
])("readApkg on a real Anki 26 %s export", (_, file) => {
  it("reads every deck with cards, keeping the sub-deck path", async () => {
    const { decks } = await readApkg(fixture(file));
    expect(decks.map((d) => [d.name, d.cards.length])).toEqual([
      ["Fixture::Sub", 3],
      ["Other", 2],
    ]);
  });

  it("renders HTML to text, converts MathJax, and finds bundled images", async () => {
    const { decks, readMedia } = await readApkg(fixture(file));
    const [basic] = decks[0].cards;
    expect(basic.front).toEqual({ text: "What is 2 & 2?\nThink $x^2$", media: [] });
    expect(basic.back).toEqual({ text: "Four\nsee", media: [{ type: "image", file: "dot.png" }] });
    const png = await readMedia("dot.png");
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("keeps remote video URLs and reports unbundled sound files as missing", async () => {
    const { decks, readMedia } = await readApkg(fixture(file));
    expect(decks[0].cards[1].back.media).toEqual([
      { type: "video", url: "https://example.com/v.mp4" },
      { type: "audio", file: "clip.mp3" },
    ]);
    expect(await readMedia("clip.mp3")).toBeNull();
  });

  it("renders cloze deletions with their hint on the front and the answer on the back", async () => {
    const { decks } = await readApkg(fixture(file));
    expect(decks[0].cards[2].front.text).toBe("Oslo is the capital of [country]");
    expect(decks[0].cards[2].back.text).toBe("Oslo is the capital of Norway\nSince 1814");
  });

  it("yields one flashcard per Anki card, so a reversed note gives both directions", async () => {
    const { decks } = await readApkg(fixture(file));
    expect(decks[1].cards.map((c) => [c.front.text, c.back.text])).toEqual([
      ["hund", "dog"],
      ["dog", "hund"],
    ]);
  });
});

describe("readApkg round trip with apkgWriter", () => {
  it("renders a template's <video src=\"{{Field}}\"> as a video front and the rest as the back", async () => {
    const noteType: AnkiNoteType = {
      id: stableId("test-video"),
      name: "Video (test)",
      fields: ["Word", "Video", "Note"],
      templates: [
        {
          name: "Video → word",
          qfmt: '<video src="{{Video}}" autoplay loop muted></video>',
          afmt: "{{FrontSide}}\n<hr id=answer>\n<div>{{Word}}</div>\n{{#Note}}<div>{{Note}}</div>{{/Note}}",
        },
      ],
    };
    const apkg = await writeApkg({
      noteType,
      decks: [{ name: "Parent::Child", notes: [{ guid: "g", fields: ["hund", "https://x.test/hund.mp4", "dyr"] }] }],
    });
    const { decks } = await readApkg(apkg);
    expect(decks).toEqual([
      {
        name: "Parent::Child",
        cards: [
          {
            front: { text: "", media: [{ type: "video", url: "https://x.test/hund.mp4" }] },
            back: { text: "hund\ndyr", media: [] },
          },
        ],
      },
    ]);
  });
});

describe("readApkg errors", () => {
  it("rejects a file that isn't a zip", async () => {
    await expect(readApkg(Buffer.from("not a zip"))).rejects.toThrow(ApkgFormatError);
  });

  it("rejects a zip without a collection", async () => {
    const zip = new JSZip();
    zip.file("media", "{}");
    await expect(readApkg(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(/No Anki collection/);
  });
});

describe("readProto", () => {
  it("decodes varint and length-delimited fields", () => {
    // field 1 = "hi", field 2 = 300 (varint 0xac 0x02)
    const buf = Buffer.from([0x0a, 0x02, 0x68, 0x69, 0x10, 0xac, 0x02]);
    const fields = readProto(buf);
    expect(fields[0].bytes?.toString()).toBe("hi");
    expect(fields[1]).toEqual({ field: 2, varint: BigInt(300) });
  });

  it("throws on truncated input instead of reading past the end", () => {
    expect(() => readProto(Buffer.from([0x0a, 0x05, 0x68]))).toThrow(ApkgFormatError);
  });
});
