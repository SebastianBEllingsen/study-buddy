import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { writeApkg, fieldChecksum, stableId, type AnkiNoteType } from "./apkgWriter";

const BASIC: AnkiNoteType = {
  id: stableId("test-basic"),
  name: "Basic (test)",
  fields: ["Front", "Back"],
  templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }],
};

async function open(apkg: Buffer) {
  const zip = await JSZip.loadAsync(apkg);
  const collection = await zip.file("collection.anki2")!.async("nodebuffer");
  const media = JSON.parse(await zip.file("media")!.async("string"));
  return { zip, db: new Database(collection), media };
}

describe("writeApkg", () => {
  it("writes a legacy v11 collection with the note type, decks, notes and new cards", async () => {
    const apkg = await writeApkg({
      noteType: BASIC,
      decks: [
        {
          name: "Parent::Child",
          notes: [
            { guid: "g1", fields: ["<b>hund</b>", "dog"], tags: ["dyr", "two words"] },
            { guid: "g2", fields: ["katt", "cat"] },
          ],
        },
      ],
      now: 1_700_000_000_000,
    });
    const { db, media } = await open(apkg);
    try {
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      const col = db.prepare("SELECT ver, models, decks FROM col").get() as {
        ver: number;
        models: string;
        decks: string;
      };
      expect(col.ver).toBe(11);
      const model = JSON.parse(col.models)[String(BASIC.id)];
      expect(model.flds.map((f: { name: string }) => f.name)).toEqual(["Front", "Back"]);
      expect(model.tmpls[0].qfmt).toBe("{{Front}}");
      const deckNames = Object.values(JSON.parse(col.decks)).map((d) => (d as { name: string }).name);
      expect(deckNames).toEqual(["Default", "Parent", "Parent::Child"]);

      const notes = db.prepare("SELECT guid, tags, flds, sfld, csum FROM notes ORDER BY id").all() as {
        guid: string;
        tags: string;
        flds: string;
        sfld: string;
        csum: number;
      }[];
      expect(notes.map((n) => n.guid)).toEqual(["g1", "g2"]);
      expect(notes[0].flds).toBe("<b>hund</b>\x1fdog");
      expect(notes[0].sfld).toBe("hund");
      expect(notes[0].csum).toBe(fieldChecksum("hund"));
      expect(notes[0].tags).toBe(" dyr two_words ");

      const cards = db.prepare("SELECT did, ord, type, queue, due FROM cards ORDER BY id").all();
      expect(cards).toEqual([
        { did: stableId("deck:Parent::Child"), ord: 0, type: 0, queue: 0, due: 1 },
        { did: stableId("deck:Parent::Child"), ord: 0, type: 0, queue: 0, due: 2 },
      ]);
      expect(media).toEqual({});
    } finally {
      db.close();
    }
  });

  it("bundles media files under numbered zip entries", async () => {
    const apkg = await writeApkg({
      noteType: BASIC,
      decks: [{ name: "D", notes: [{ guid: "g", fields: ['<img src="a.png">', ""] }] }],
      mediaFiles: new Map([["a.png", Buffer.from([1, 2, 3])]]),
    });
    const { zip, db, media } = await open(apkg);
    db.close();
    expect(media).toEqual({ "0": "a.png" });
    expect([...(await zip.file("0")!.async("uint8array"))]).toEqual([1, 2, 3]);
  });

  it("rejects a note whose field count doesn't match the note type", async () => {
    await expect(
      writeApkg({ noteType: BASIC, decks: [{ name: "D", notes: [{ guid: "g", fields: ["only one"] }] }] })
    ).rejects.toThrow(/expects 2/);
  });
});
