// Converts decks read from an .apkg (lib/anki/apkgReader.ts) into Study
// Buddy flashcards, resolving each media reference to a URL the viewer can
// load: remote URLs pass through, bundled files go through `storeFile`.

import crypto from "node:crypto";
import path from "node:path";
import { isSafeCardMediaSrc } from "@/lib/cardMedia";
import type { CardMedia, Flashcard } from "@/lib/types";
import type { ImportedMedia } from "./ankiHtml";
import type { ApkgContents, ImportedDeck } from "./apkgReader";

export const MEDIA_MIME_BY_EXTENSION = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".flac", "audio/flac"],
  [".opus", "audio/ogg"],
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".webm", "video/webm"],
  [".ogv", "video/ogg"],
  [".mov", "video/quicktime"],
]);

export interface ImportStats {
  cards: number;
  mediaStored: number;
  // References to files the package didn't include, or of a type we can't
  // serve — the card is kept, just without that clip.
  mediaSkipped: number;
}

// Stores one bundled media file; returns the URL to reference it by, or
// null when it couldn't be stored.
export type StoreMediaFile = (key: string, bytes: Buffer, contentType: string) => Promise<string | null>;

export function deckTitle(deckName: string): string {
  return deckName.split("::").join(" › ");
}

export async function importDeckCards(
  deck: ImportedDeck,
  contents: Pick<ApkgContents, "readMedia">,
  storeFile: StoreMediaFile,
  // Shared across decks from one package, so a file several decks use is
  // stored once.
  storedUrls: Map<string, string | null> = new Map()
): Promise<{ cards: Flashcard[]; stats: ImportStats }> {
  const stats: ImportStats = { cards: 0, mediaStored: 0, mediaSkipped: 0 };

  async function resolve(media: ImportedMedia): Promise<CardMedia | null> {
    if ("url" in media) {
      return isSafeCardMediaSrc(media.url, media.type) ? { type: media.type, src: media.url } : null;
    }
    if (!storedUrls.has(media.file)) {
      const ext = path.extname(media.file).toLowerCase();
      const contentType = MEDIA_MIME_BY_EXTENSION.get(ext);
      const bytes = contentType ? await contents.readMedia(media.file) : null;
      const stored = bytes && contentType ? await storeFile(`anki/${crypto.randomUUID()}${ext}`, bytes, contentType) : null;
      const url = stored && isSafeCardMediaSrc(stored, media.type) ? stored : null;
      storedUrls.set(media.file, url);
      if (url) stats.mediaStored++;
    }
    const src = storedUrls.get(media.file);
    return src ? { type: media.type, src } : null;
  }

  async function resolveAll(list: ImportedMedia[]): Promise<CardMedia[]> {
    const out: CardMedia[] = [];
    for (const m of list) {
      const resolved = await resolve(m);
      if (resolved) out.push(resolved);
      else stats.mediaSkipped++;
    }
    return out;
  }

  const cards: Flashcard[] = [];
  for (const card of deck.cards) {
    const frontMedia = await resolveAll(card.front.media);
    const backMedia = await resolveAll(card.back.media);
    cards.push({
      front: card.front.text,
      back: card.back.text,
      ...(frontMedia.length ? { frontMedia } : {}),
      ...(backMedia.length ? { backMedia } : {}),
    });
  }
  stats.cards = cards.length;
  return { cards, stats };
}
