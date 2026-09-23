import { blobStore } from "@/lib/blobStorage";
import { createGeneratedItem, getAppSettings, getCourse, getFolder } from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { formatMegabytes } from "@/lib/uploadLimits";
import { ApkgFormatError, readApkg } from "@/lib/anki/apkgReader";
import { deckTitle, importDeckCards, type StoreMediaFile } from "@/lib/anki/importDeck";

// Imports an Anki .apkg as flashcard sets — one per Anki deck with cards —
// filed like any generated item. Created as a "hand-picked" source with no
// documents, so the item page never offers to "add cards from new
// documents" to a deck the AI didn't write.
const MAX_APKG_BYTES = 200_000_000;
// Without a blob store (Supabase DB mode, Storage not configured) bundled
// media is inlined into the card JSON as a data: URL — only when small.
const MAX_INLINE_MEDIA_BYTES = 1_000_000;

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null || !(await getCourse(id))) {
    return Response.json({ error: "Course not found" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folderIdRaw = formData.get("folderId");
    const folderId = folderIdRaw === null ? null : Number(folderIdRaw);
    if (!(file instanceof File)) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (folderId !== null) {
      const folder = Number.isInteger(folderId) ? await getFolder(folderId) : undefined;
      if (!folder || folder.course_id !== id) {
        return Response.json({ error: "Invalid folder" }, { status: 400 });
      }
    }
    const { unlimitedUploads } = await getAppSettings();
    if (!unlimitedUploads && file.size > MAX_APKG_BYTES) {
      return Response.json(
        { error: `Anki deck is too large (max ${formatMegabytes(MAX_APKG_BYTES)})` },
        { status: 400 }
      );
    }

    const contents = await readApkg(Buffer.from(await file.arrayBuffer()));
    if (contents.decks.length === 0) {
      return Response.json({ error: "That Anki package has no cards in it" }, { status: 400 });
    }

    const storeFile: StoreMediaFile = async (key, bytes, contentType) => {
      const stored = blobStore ? await blobStore.put(key, bytes, contentType) : null;
      if (stored) return stored.url;
      if (bytes.length > MAX_INLINE_MEDIA_BYTES) return null;
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    };

    const storedUrls = new Map<string, string | null>();
    const items: { id: number; title: string; cards: number }[] = [];
    let mediaSkipped = 0;
    for (const deck of contents.decks) {
      const { cards, stats } = await importDeckCards(deck, contents, storeFile, storedUrls);
      mediaSkipped += stats.mediaSkipped;
      const title = deckTitle(deck.name);
      const item = await createGeneratedItem({
        courseId: id,
        folderId,
        sourceFolderId: null,
        sourceHandpicked: true,
        mode: "flashcards",
        title,
        contentJson: { cards },
        sourceDocumentIds: [],
      });
      items.push({ id: item.id, title, cards: cards.length });
    }

    return Response.json({ items, mediaSkipped }, { status: 201 });
  } catch (err) {
    if (err instanceof ApkgFormatError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Anki import failed:", err);
    return Response.json({ error: "Couldn't import that Anki deck" }, { status: 500 });
  }
}
