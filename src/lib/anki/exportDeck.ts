// Study Buddy flashcards → an Anki .apkg (via lib/anki/apkgWriter.ts), with
// a plain Front/Back note type. Text becomes field HTML (escaped, line
// breaks as <br>, $…$ math as Anki's \(…\)); media that lives in this app
// (blob or data: URLs) is bundled into the package, remote media stays a
// link that Anki streams from its original host.

import { createHash } from "node:crypto";
import type { CardMedia, Flashcard } from "@/lib/types";
import { stableGuid, stableId, writeApkg, type AnkiNoteType } from "./apkgWriter";
import { MEDIA_MIME_BY_EXTENSION } from "./importDeck";

export const STUDY_BUDDY_NOTE_TYPE: AnkiNoteType = {
  id: stableId("note-type:study-buddy-basic:v1"),
  name: "Basic (Study Buddy)",
  fields: ["Front", "Back"],
  templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}" }],
  css: `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
}
.nightMode.card { color: #eee; background-color: #2f2f31; }
video, img { max-width: 100%; max-height: 60vh; }`,
};

// Bytes of a piece of card media that lives in this app, or null when the
// source is remote (or gone) and should stay a link.
export type LoadLocalMedia = (src: string) => Promise<{ bytes: Buffer; ext: string } | null>;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToFieldHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => `\\[${tex}\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_, tex: string) => `\\(${tex}\\)`)
    .replace(/\n/g, "<br>");
}

function mediaHtml(type: CardMedia["type"], src: string): string {
  const s = escapeHtml(src);
  if (type === "image") return `<img src="${s}">`;
  if (type === "audio") return `<audio src="${s}" controls></audio>`;
  return `<video src="${s}" autoplay loop muted playsinline controls></video>`;
}

export async function flashcardsToApkg(options: {
  itemId: number;
  deckName: string;
  cards: Flashcard[];
  loadLocalMedia: LoadLocalMedia;
}): Promise<Buffer> {
  const mediaFiles = new Map<string, Buffer>();
  const bundledName = new Map<string, string>();

  async function renderMedia(list: CardMedia[] = []): Promise<string> {
    const parts: string[] = [];
    for (const m of list) {
      let src = bundledName.get(m.src);
      if (src === undefined) {
        const local = await options.loadLocalMedia(m.src);
        if (local && MEDIA_MIME_BY_EXTENSION.has(local.ext)) {
          // Content-addressed, so the same file is bundled once and
          // re-exports don't pile up duplicates in Anki's media folder.
          src = `study-buddy-${createHash("sha1").update(local.bytes).digest("hex").slice(0, 16)}${local.ext}`;
          mediaFiles.set(src, local.bytes);
        } else {
          src = m.src;
        }
        bundledName.set(m.src, src);
      }
      parts.push(mediaHtml(m.type, src));
    }
    return parts.join("<br>");
  }

  const notes = [];
  for (const [index, card] of options.cards.entries()) {
    const face = async (text: string, media?: CardMedia[]) =>
      [await renderMedia(media), textToFieldHtml(text)].filter(Boolean).join("<br>");
    notes.push({
      // Tied to the Study Buddy item + card position: re-exporting the same
      // set updates its notes in Anki instead of duplicating them.
      guid: stableGuid(`study-buddy:${options.itemId}:${index}`),
      fields: [await face(card.front, card.frontMedia), await face(card.back, card.backMedia)],
      tags: ["study-buddy"],
    });
  }

  return writeApkg({
    noteType: STUDY_BUDDY_NOTE_TYPE,
    decks: [{ name: options.deckName, notes }],
    mediaFiles,
  });
}
