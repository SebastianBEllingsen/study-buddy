import path from "node:path";
import { getGeneratedItem } from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { blobKeyFromUrl } from "@/lib/blobStorage";
import { readLocalBlob } from "@/lib/blobStorage/local";
import { flashcardsToApkg, type LoadLocalMedia } from "@/lib/anki/exportDeck";
import { MEDIA_MIME_BY_EXTENSION } from "@/lib/anki/importDeck";
import type { FlashcardsContent } from "@/lib/types";

// Downloads a flashcard set as an Anki .apkg — see lib/anki/exportDeck.ts.

type Params = { params: Promise<{ itemId: string }> };

// mime → extension; reversed so the first extension listed per type
// (".jpg" over ".jpeg", ".ogg" over ".oga") is the one that sticks.
const EXTENSION_BY_MIME = new Map<string, string>(
  [...MEDIA_MIME_BY_EXTENSION].map(([ext, mime]): [string, string] => [mime, ext]).reverse()
);

// Media this app holds itself — a local blob (/api/blobs/…) or an inline
// data: URL — is bundled; anything else (including Supabase Storage's
// public https URLs) stays a link Anki fetches on its own.
const loadLocalMedia: LoadLocalMedia = async (src) => {
  if (src.startsWith("/api/blobs/")) {
    const key = blobKeyFromUrl(src);
    const bytes = key ? await readLocalBlob(key) : null;
    return bytes ? { bytes, ext: path.extname(key!).toLowerCase() } : null;
  }
  const data = src.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([\s\S]*)$/);
  if (data) {
    const ext = EXTENSION_BY_MIME.get(data[1]);
    return ext ? { bytes: Buffer.from(data[2], "base64"), ext } : null;
  }
  return null;
};

export async function GET(_request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  const item = id === null ? undefined : await getGeneratedItem(id);
  if (!item || item.mode !== "flashcards") {
    return Response.json({ error: "Flashcard set not found" }, { status: 404 });
  }

  try {
    const { cards } = JSON.parse(item.content_json) as FlashcardsContent;
    const apkg = await flashcardsToApkg({
      itemId: item.id,
      // Undo the import's "A › B" titling so a round trip lands in the
      // same Anki sub-deck.
      deckName: item.title.split(" › ").join("::"),
      cards,
      loadLocalMedia,
    });
    const filename = `${item.title.replace(/[^\p{L}\p{N}\- ]+/gu, " ").replace(/\s+/g, " ").trim() || "flashcards"}.apkg`;
    return new Response(new Uint8Array(apkg), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("Anki export failed:", err);
    return Response.json({ error: "Couldn't export this flashcard set" }, { status: 500 });
  }
}
