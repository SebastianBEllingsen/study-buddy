// Writes Anki .apkg packages: a zip holding a legacy-schema (v11)
// `collection.anki2` SQLite database plus a `media` JSON map. Every current
// Anki client (desktop, AnkiDroid, AnkiMobile) imports this format and
// upgrades it on the fly — it's also what genanki and Anki's own
// "support older versions" export produce.

import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import JSZip from "jszip";

export interface AnkiTemplate {
  name: string;
  qfmt: string;
  afmt: string;
}

export interface AnkiNoteType {
  // Stable across runs so re-importing a regenerated deck reuses the same
  // note type in Anki instead of creating "Name+" copies.
  id: number;
  name: string;
  fields: string[];
  templates: AnkiTemplate[];
  css?: string;
}

export interface AnkiNote {
  // Anki's identity for a note across imports: same guid ⇒ the note is
  // updated in place (review history kept) rather than duplicated.
  guid: string;
  fields: string[];
  tags?: string[];
}

export interface AnkiDeck {
  // "::" separates sub-decks, e.g. "Languages::Spanish".
  name: string;
  notes: AnkiNote[];
}

export interface WriteApkgOptions {
  noteType: AnkiNoteType;
  decks: AnkiDeck[];
  // Filename (as referenced from field HTML) → bytes.
  mediaFiles?: Map<string, Buffer>;
  // Injectable for deterministic tests.
  now?: number;
}

const DEFAULT_CSS = `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
}`;

// Stable positive 48-bit id from a string — well inside JS's safe-integer
// range and SQLite's int64, and never colliding with Anki's default deck 1.
export function stableId(key: string): number {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 12);
  return parseInt(hex, 16) + 2;
}

// A short, stable guid in Anki's own base91-ish style — any unique string
// works, this just keeps them compact.
export function stableGuid(key: string): string {
  return createHash("sha1").update(key).digest("base64").slice(0, 10);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// Anki's duplicate-detection checksum: first 8 hex digits of the SHA-1 of
// the stripped first field, as an integer.
export function fieldChecksum(firstField: string): number {
  return parseInt(createHash("sha1").update(stripHtml(firstField)).digest("hex").slice(0, 8), 16);
}

const SCHEMA = `
CREATE TABLE col (
  id integer primary key, crt integer not null, mod integer not null,
  scm integer not null, ver integer not null, dty integer not null,
  usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null,
  tags text not null
);
CREATE TABLE notes (
  id integer primary key, guid text not null, mid integer not null,
  mod integer not null, usn integer not null, tags text not null,
  flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null
);
CREATE TABLE cards (
  id integer primary key, nid integer not null, did integer not null,
  ord integer not null, mod integer not null, usn integer not null,
  type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null,
  lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null
);
CREATE TABLE revlog (
  id integer primary key, cid integer not null, usn integer not null,
  ease integer not null, ivl integer not null, lastIvl integer not null,
  factor integer not null, time integer not null, type integer not null
);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function deckJson(id: number, name: string, modSeconds: number) {
  return {
    id,
    name,
    mod: modSeconds,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: "",
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
  };
}

const DEFAULT_DECK_CONFIG = {
  id: 1,
  name: "Default",
  mod: 0,
  usn: 0,
  maxTaken: 60,
  autoplay: true,
  timer: 0,
  replayq: true,
  dyn: false,
  new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, order: 1, perDay: 20, bury: true, separate: true },
  lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
  rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: true, hardFactor: 1.2 },
};

// Every ancestor of "A::B::C" ("A", "A::B") plus itself — created
// explicitly rather than relying on each client to fill in missing parents.
function withParents(names: string[]): string[] {
  const all = new Set<string>();
  for (const name of names) {
    const parts = name.split("::");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join("::"));
  }
  return [...all];
}

export async function writeApkg(options: WriteApkgOptions): Promise<Buffer> {
  const { noteType, decks } = options;
  const nowMs = options.now ?? Date.now();
  const nowS = Math.floor(nowMs / 1000);

  for (const deck of decks) {
    for (const note of deck.notes) {
      if (note.fields.length !== noteType.fields.length) {
        throw new Error(
          `Note ${note.guid} has ${note.fields.length} fields, note type "${noteType.name}" expects ${noteType.fields.length}`
        );
      }
    }
  }

  const deckIds = new Map<string, number>();
  const decksJson: Record<string, unknown> = { "1": deckJson(1, "Default", nowS) };
  for (const name of withParents(decks.map((d) => d.name))) {
    const id = stableId(`deck:${name}`);
    deckIds.set(name, id);
    decksJson[String(id)] = deckJson(id, name, nowS);
  }
  const firstDeckId = deckIds.get(decks[0]?.name ?? "") ?? 1;

  const model = {
    id: noteType.id,
    name: noteType.name,
    type: 0,
    mod: nowS,
    usn: -1,
    sortf: 0,
    did: firstDeckId,
    tmpls: noteType.templates.map((t, ord) => ({
      name: t.name,
      ord,
      qfmt: t.qfmt,
      afmt: t.afmt,
      bqfmt: "",
      bafmt: "",
      did: null,
      bfont: "",
      bsize: 0,
    })),
    flds: noteType.fields.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: false,
      font: "Arial",
      size: 20,
      media: [],
    })),
    css: noteType.css ?? DEFAULT_CSS,
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    // Legacy "which fields must be non-empty for card N to exist" — every
    // template is generated whenever the first field is present.
    req: noteType.templates.map((_, ord) => [ord, "any", [0]]),
    tags: [],
    vers: [],
  };

  const conf = {
    activeDecks: [1],
    curDeck: firstDeckId,
    newSpread: 0,
    collapseTime: 1200,
    timeLim: 0,
    estTimes: true,
    dueCounts: true,
    curModel: String(noteType.id),
    nextPos: 1,
    sortType: "noteFld",
    sortBackwards: false,
    addToCur: true,
  };

  const db = new Database(":memory:");
  try {
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`
    ).run(
      nowS,
      nowMs,
      nowMs,
      JSON.stringify(conf),
      JSON.stringify({ [String(noteType.id)]: model }),
      JSON.stringify(decksJson),
      JSON.stringify({ "1": DEFAULT_DECK_CONFIG })
    );

    const insertNote = db.prepare(
      `INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`
    );
    const insertCard = db.prepare(
      `INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`
    );

    // Ids are millisecond-timestamp-shaped like Anki's own, just
    // incremented per row so they never collide within the package.
    let nextNoteId = nowMs;
    let nextCardId = nowMs;
    let position = 0;
    db.transaction(() => {
      for (const deck of decks) {
        const did = deckIds.get(deck.name)!;
        for (const note of deck.notes) {
          const nid = nextNoteId++;
          const tags = note.tags?.length ? ` ${note.tags.map((t) => t.replace(/\s+/g, "_")).join(" ")} ` : "";
          insertNote.run(
            nid,
            note.guid,
            noteType.id,
            nowS,
            tags,
            note.fields.join("\x1f"),
            stripHtml(note.fields[0]),
            fieldChecksum(note.fields[0])
          );
          position++;
          noteType.templates.forEach((_, ord) => {
            insertCard.run(nextCardId++, nid, did, ord, nowS, position);
          });
        }
      }
    })();

    const zip = new JSZip();
    zip.file("collection.anki2", db.serialize());
    const mediaMap: Record<string, string> = {};
    let index = 0;
    for (const [filename, bytes] of options.mediaFiles ?? []) {
      mediaMap[String(index)] = filename;
      zip.file(String(index), bytes);
      index++;
    }
    zip.file("media", JSON.stringify(mediaMap));
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    db.close();
  }
}
