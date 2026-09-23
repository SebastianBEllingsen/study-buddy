// Reads Anki .apkg packages in every format Anki has exported:
// - collection.anki21b: zstd-compressed, schema v18 (note types/templates/
//   decks in their own tables, template config as protobuf). Anki's
//   default export since 2.1.50 — alongside a dummy collection.anki2 that
//   just says "please update".
// - collection.anki21 / collection.anki2: schema v11, note types and decks
//   as JSON in the `col` row. ("Support older Anki versions" exports, and
//   what lib/anki/apkgWriter.ts writes.)
// The media map is JSON in older packages, zstd + protobuf in newer ones,
// where each media file is also zstd-compressed.
//
// Output is one deck per Anki deck that has cards, one flashcard per Anki
// card (so "Basic (and reversed)" yields both directions and each cloze
// number its own card, as in Anki). Scheduling is not carried over.

import zlib from "node:zlib";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { answerPart, htmlToCardFace, renderTemplate, type CardFaceContent } from "./ankiHtml";

export interface ImportedCard {
  front: CardFaceContent;
  back: CardFaceContent;
}

export interface ImportedDeck {
  // Anki's full deck path, "::"-separated.
  name: string;
  cards: ImportedCard[];
}

export interface ApkgContents {
  decks: ImportedDeck[];
  // Bytes of a file from the package's media bundle, by the name cards
  // reference it with — null when the package doesn't include it.
  readMedia(name: string): Promise<Buffer | null>;
}

export class ApkgFormatError extends Error {}

// Hard cap on any single decompressed entry — a zip/zstd bomb guard.
const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// Node ≥ 22.15 ships zstd in zlib; the project's @types/node (v20) predates
// it, hence the typed lookup rather than a direct call.
const zstdDecompressSync = (
  zlib as unknown as {
    zstdDecompressSync?: (buf: Buffer, options: { maxOutputLength: number }) => Buffer;
  }
).zstdDecompressSync;

function maybeZstd(bytes: Buffer): Buffer {
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(ZSTD_MAGIC)) {
    if (!zstdDecompressSync) {
      throw new ApkgFormatError(
        "This deck uses Anki's newer compressed format, which needs Node.js 22.15 or later to read. " +
          'Re-export it from Anki with "Support older Anki versions" ticked, or update Node.'
      );
    }
    return zstdDecompressSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  }
  return bytes;
}

// Minimal protobuf wire-format reader — only what Anki's MediaEntries and
// CardTemplateConfig messages need (varints and length-delimited fields).
type ProtoField = { field: number; varint?: bigint; bytes?: Buffer };

export function readProto(buf: Buffer): ProtoField[] {
  const out: ProtoField[] = [];
  let pos = 0;
  const varint = (): bigint => {
    let result = BigInt(0);
    let shift = BigInt(0);
    for (;;) {
      if (pos >= buf.length) throw new ApkgFormatError("Truncated protobuf");
      const b = buf[pos++];
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += BigInt(7);
    }
  };
  while (pos < buf.length) {
    const key = Number(varint());
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ field, varint: varint() });
    else if (wire === 2) {
      const len = Number(varint());
      if (pos + len > buf.length) throw new ApkgFormatError("Truncated protobuf");
      out.push({ field, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else throw new ApkgFormatError(`Unsupported protobuf wire type ${wire}`);
  }
  return out;
}

function protoString(fields: ProtoField[], field: number): string {
  return fields.find((f) => f.field === field)?.bytes?.toString("utf8") ?? "";
}

interface NoteType {
  fieldNames: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
  isCloze: boolean;
}

// Opens a private in-memory copy of a collection from its bytes, patched
// so plain SQLite can read it:
// - Anki saves collections in WAL mode (header bytes 18/19 = 2), which a
//   deserialized database can't open ("unable to open database file").
//   Flipping them to 1 selects the rollback journal; page data is the same.
// - Anki's v18 schema declares text columns `COLLATE unicase`, its own
//   collation, which SQLite refuses to query through — and better-sqlite3
//   can neither register collations nor (in its defensive mode) rewrite
//   sqlite_master. So the schema text is patched in place to the built-in
//   `COLLATE NOCASE ` — byte-for-byte the same length, so every record and
//   page offset stays valid.
const UNICASE = Buffer.from("COLLATE unicase");
const NOCASE = Buffer.from("COLLATE NOCASE ");

function openCollection(input: Buffer): Database.Database {
  const bytes = Buffer.from(input);
  if (bytes.length >= 100 && bytes[18] === 2 && bytes[19] === 2) {
    bytes[18] = 1;
    bytes[19] = 1;
  }
  for (let i = bytes.indexOf(UNICASE); i !== -1; i = bytes.indexOf(UNICASE, i + UNICASE.length)) {
    NOCASE.copy(bytes, i);
  }
  return new Database(bytes);
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function loadNoteTypes(db: Database.Database): Map<number, NoteType> {
  const types = new Map<number, NoteType>();
  if (hasTable(db, "notetypes")) {
    for (const nt of db.prepare("SELECT id FROM notetypes").all() as { id: number }[]) {
      const fieldNames = (
        db.prepare("SELECT name FROM fields WHERE ntid = ? ORDER BY ord").all(nt.id) as { name: string }[]
      ).map((f) => f.name);
      const templates = (
        db.prepare("SELECT name, config FROM templates WHERE ntid = ? ORDER BY ord").all(nt.id) as {
          name: string;
          config: Buffer;
        }[]
      ).map((t) => {
        const config = readProto(t.config);
        return { name: t.name, qfmt: protoString(config, 1), afmt: protoString(config, 2) };
      });
      types.set(nt.id, {
        fieldNames,
        templates,
        isCloze: templates.some((t) => /\{\{[^}]*cloze:/.test(t.qfmt)),
      });
    }
    return types;
  }

  const row = db.prepare("SELECT models FROM col").get() as { models: string } | undefined;
  const models = JSON.parse(row?.models || "{}") as Record<
    string,
    { type?: number; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[] }
  >;
  for (const [id, m] of Object.entries(models)) {
    types.set(Number(id), {
      fieldNames: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map(({ name, qfmt, afmt }) => ({ name, qfmt, afmt })),
      isCloze: m.type === 1,
    });
  }
  return types;
}

function loadDeckNames(db: Database.Database): Map<number, string> {
  const names = new Map<number, string>();
  if (hasTable(db, "decks")) {
    for (const d of db.prepare("SELECT id, name FROM decks").all() as { id: number; name: string }[]) {
      names.set(d.id, d.name.split("\x1f").join("::"));
    }
    return names;
  }
  const row = db.prepare("SELECT decks FROM col").get() as { decks: string } | undefined;
  for (const [id, d] of Object.entries(JSON.parse(row?.decks || "{}") as Record<string, { name: string }>)) {
    names.set(Number(id), d.name);
  }
  return names;
}

async function loadMediaMap(zip: JSZip): Promise<Map<string, string>> {
  // media filename → zip entry name
  const map = new Map<string, string>();
  const entry = zip.file("media");
  if (!entry) return map;
  const raw = await entry.async("nodebuffer");
  if (raw.subarray(0, 4).equals(ZSTD_MAGIC)) {
    readProto(maybeZstd(raw))
      .filter((f) => f.field === 1 && f.bytes)
      .forEach((f, index) => {
        const e = readProto(f.bytes!);
        const name = protoString(e, 1);
        const legacyName = e.find((x) => x.field === 255)?.varint;
        if (name) map.set(name, String(legacyName ?? index));
      });
    return map;
  }
  const json = raw.toString("utf8").trim();
  if (!json) return map;
  for (const [zipName, name] of Object.entries(JSON.parse(json) as Record<string, string>)) {
    map.set(name, zipName);
  }
  return map;
}

export async function readApkg(bytes: Buffer): Promise<ApkgContents> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ApkgFormatError("That isn't a valid .apkg file (not a zip archive)");
  }
  const collectionEntry =
    zip.file("collection.anki21b") ?? zip.file("collection.anki21") ?? zip.file("collection.anki2");
  if (!collectionEntry) throw new ApkgFormatError("No Anki collection found in that .apkg file");

  let db: Database.Database;
  try {
    db = openCollection(maybeZstd(await collectionEntry.async("nodebuffer")));
  } catch (err) {
    if (err instanceof ApkgFormatError) throw err;
    throw new ApkgFormatError("Couldn't open the Anki collection inside that .apkg file");
  }

  try {
    const noteTypes = loadNoteTypes(db);
    const deckNames = loadDeckNames(db);
    const rows = db
      .prepare(
        `SELECT c.ord, c.did, c.odid, n.mid, n.flds, n.tags
         FROM cards c JOIN notes n ON n.id = c.nid
         ORDER BY c.did, c.type, c.due, n.id, c.ord`
      )
      .all() as { ord: number; did: number; odid: number; mid: number; flds: string; tags: string }[];

    const decks = new Map<string, ImportedDeck>();
    for (const row of rows) {
      const noteType = noteTypes.get(row.mid);
      if (!noteType) continue;
      const values = row.flds.split("\x1f");
      const fields = Object.fromEntries(noteType.fieldNames.map((name, i) => [name, values[i] ?? ""]));
      const template = noteType.isCloze ? noteType.templates[0] : noteType.templates[row.ord];
      if (!template) continue;

      // A card sitting in a filtered deck belongs to its original deck.
      const deckName = deckNames.get(row.odid || row.did) ?? "Imported";
      const ctx = {
        fields,
        clozeOrdinal: noteType.isCloze ? row.ord + 1 : undefined,
        tags: row.tags.trim(),
        deck: deckName,
        cardName: template.name,
      };
      const front = htmlToCardFace(renderTemplate(template.qfmt, "front", ctx));
      const back = htmlToCardFace(answerPart(renderTemplate(template.afmt, "back", ctx)));
      if (!front.text && !front.media.length && !back.text && !back.media.length) continue;

      const deck = decks.get(deckName) ?? { name: deckName, cards: [] };
      deck.cards.push({ front, back });
      decks.set(deckName, deck);
    }

    const mediaMap = await loadMediaMap(zip);
    return {
      decks: [...decks.values()],
      async readMedia(name) {
        const zipName = mediaMap.get(name) ?? mediaMap.get(safeDecodeUri(name));
        const entry = zipName !== undefined ? zip.file(zipName) : null;
        return entry ? maybeZstd(await entry.async("nodebuffer")) : null;
      },
    };
  } finally {
    db.close();
  }
}

function safeDecodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
