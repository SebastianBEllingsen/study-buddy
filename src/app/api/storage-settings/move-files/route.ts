import {
  canMoveToStorage,
  compactDocuments,
  databaseSizeBytes,
  documentsLeftToMove,
  localizeBlobUrls,
  moveDocuments,
} from "@/lib/blobStorage/moveToStorage";
import { parseJsonObjectBody } from "@/lib/requestBody";

// Moving files out of the Supabase database into Storage — see
// lib/blobStorage/moveToStorage.ts. Settings calls the steps in order:
// "images" once, "documents" until none remain, then "compact".

export async function GET() {
  if (!canMoveToStorage()) return Response.json({ available: false });
  const [remaining, bytes] = await Promise.all([documentsLeftToMove(), databaseSizeBytes()]);
  return Response.json({ available: true, documentsRemaining: remaining, databaseBytes: bytes });
}

export async function POST(request: Request) {
  if (!canMoveToStorage()) {
    return Response.json({ error: "Needs Supabase with Storage set up" }, { status: 400 });
  }
  const { step } = await parseJsonObjectBody(request);
  try {
    if (step === "images") {
      await localizeBlobUrls();
      return Response.json({ ok: true });
    }
    if (step === "documents") {
      return Response.json(await moveDocuments(20_000));
    }
    if (step === "compact") {
      await compactDocuments();
      return Response.json({ databaseBytes: await databaseSizeBytes() });
    }
    return Response.json({ error: "Unknown step" }, { status: 400 });
  } catch (err) {
    console.error(`Moving files (${String(step)}) failed:`, err);
    return Response.json({ error: err instanceof Error ? err.message : "Moving files failed" }, { status: 500 });
  }
}
