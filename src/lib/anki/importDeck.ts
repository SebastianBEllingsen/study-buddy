// Converts decks read from an .apkg (lib/anki/apkgReader.ts) into Study
// Buddy flashcards, resolving each media reference to a URL the viewer can
// load: remote URLs pass through, bundled files go through `storeFile`.

import crypto from "node:crypto";
import path from "node:path";
import { isSafeCardMediaSrc } from "@/lib/cardMedia";
import type { CardMedia, Flashcard } from "@/lib/types";
import { decodeEntities, type ImportedMedia } from "./ankiHtml";
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

// Files a card template can pull in beyond media: fonts, stylesheets and
// scripts. Only stored when a blob store serves them — they can't be
// inlined as data: URLs the way a small image can.
const ASSET_MIME_BY_EXTENSION = new Map<string, string>([
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".css", "text/css"],
  [".js", "text/javascript"],
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
): Promise<{ cards: Flashcard[]; styles: Record<string, string>; stats: ImportStats }> {
  const stats: ImportStats = { cards: 0, mediaStored: 0, mediaSkipped: 0 };

  // Stores a file from the package's media bundle; its URL, or null when
  // it's missing, of a type we don't serve, or couldn't be stored.
  async function storeBundled(file: string, kind: "media" | "any" = "media"): Promise<string | null> {
    if (!storedUrls.has(file)) {
      const ext = path.extname(file).toLowerCase();
      const contentType = MEDIA_MIME_BY_EXTENSION.get(ext) ?? (kind === "any" ? ASSET_MIME_BY_EXTENSION.get(ext) : undefined);
      const bytes = contentType ? await contents.readMedia(file) : null;
      const stored = bytes && contentType ? await storeFile(`anki/${crypto.randomUUID()}${ext}`, bytes, contentType) : null;
      storedUrls.set(file, stored);
      if (stored) stats.mediaStored++;
    }
    return storedUrls.get(file) ?? null;
  }

  async function resolve(media: ImportedMedia): Promise<CardMedia | null> {
    if ("url" in media) {
      return isSafeCardMediaSrc(media.url, media.type) ? { type: media.type, src: media.url } : null;
    }
    const stored = await storeBundled(media.file);
    return stored && isSafeCardMediaSrc(stored, media.type) ? { type: media.type, src: stored } : null;
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

  // Points a rendered card's references to bundled files at their stored
  // copies: <img>/<audio>/<video>/<source>/<script> src, [sound:…], and
  // url(…) in stylesheets. References that can't be resolved are left as
  // they are (the frame can't load them, as in a deck with missing files).
  const isBundledName = (ref: string) => !!ref && !/^([a-z][a-z0-9+.-]*:|\/|#|\/\/)/i.test(ref);
  async function rewrite(text: string, pattern: RegExp, replace: (match: RegExpExecArray) => Promise<string>) {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      out += text.slice(last, m.index) + (await replace(m as RegExpExecArray));
      last = m.index! + m[0].length;
    }
    return out + text.slice(last);
  }
  async function rewriteHtml(html: string): Promise<string> {
    let out = await rewrite(html, /\[sound:([^\]]+)\]/g, async (m) => {
      const file = decodeEntities(m[1]).trim();
      const url = await storeBundled(file);
      if (!url) return "";
      const tag = /\.(mp4|webm|mov|m4v|ogv)$/i.test(file) ? "video" : "audio";
      return `<${tag} class="sb-sound" controls preload="metadata" src="${url}"></${tag}>`;
    });
    out = await rewrite(out, /(\s(?:src|data-src|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, async (m) => {
      const ref = decodeEntities(m[2] ?? m[3] ?? "").trim();
      const url = isBundledName(ref) ? await storeBundled(ref, "any") : null;
      return url ? `${m[1]}"${url}"` : m[0];
    });
    return out;
  }
  async function rewriteCss(css: string): Promise<string> {
    return rewrite(css, /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, async (m) => {
      const ref = m[2].trim();
      const url = isBundledName(ref) ? await storeBundled(ref, "any") : null;
      return url ? `url("${url}")` : m[0];
    });
  }

  const styles: Record<string, string> = {};
  for (const [key, css] of Object.entries(deck.styles ?? {})) styles[key] = await rewriteCss(css);

  const cards: Flashcard[] = [];
  for (const card of deck.cards) {
    const frontMedia = await resolveAll(card.front.media);
    const backMedia = await resolveAll(card.back.media);
    cards.push({
      front: card.front.text,
      back: card.back.text,
      ...(frontMedia.length ? { frontMedia } : {}),
      ...(backMedia.length ? { backMedia } : {}),
      ...(card.html
        ? { html: { front: await rewriteHtml(card.html.front), back: await rewriteHtml(card.html.back), style: card.html.style } }
        : {}),
    });
  }
  stats.cards = cards.length;
  return { cards, styles: card0HasHtml(deck) ? styles : {}, stats };
}

function card0HasHtml(deck: ImportedDeck): boolean {
  return deck.cards.some((c) => c.html);
}
