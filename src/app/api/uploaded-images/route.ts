import { listUploadedImages, recordUploadedImage, type UploadedImageKind } from "@/lib/models";
import { isValidCoverImage, isValidIconImage } from "@/lib/dataUrlImage";

const VALID_KINDS: UploadedImageKind[] = ["icon", "cover"];

function parseKind(value: string | null): UploadedImageKind | null {
  return VALID_KINDS.includes(value as UploadedImageKind) ? (value as UploadedImageKind) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = parseKind(searchParams.get("kind"));
  if (!kind) return Response.json({ error: "kind must be 'icon' or 'cover'" }, { status: 400 });

  return Response.json({ images: await listUploadedImages(kind) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const kind = parseKind(body?.kind);
  if (!kind) return Response.json({ error: "kind must be 'icon' or 'cover'" }, { status: 400 });

  const valid = kind === "cover" ? isValidCoverImage(body?.dataUrl) : isValidIconImage(body?.dataUrl);
  if (!valid) return Response.json({ error: "Invalid image" }, { status: 400 });

  const image = await recordUploadedImage(kind, body.dataUrl);
  return Response.json({ image });
}
