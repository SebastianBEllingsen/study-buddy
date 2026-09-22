import { deleteCanvas, getCanvas, renameCanvas, updateCanvasData } from "@/lib/models";
import { sanitizeCanvasData } from "@/lib/canvas";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ canvasId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { canvasId } = await params;
  const id = parseId(canvasId);
  if (id === null) return Response.json({ error: "Canvas not found" }, { status: 404 });

  const canvas = await getCanvas(id);
  if (!canvas) return Response.json({ error: "Canvas not found" }, { status: 404 });
  return Response.json({ canvas });
}

export async function PATCH(request: Request, { params }: Params) {
  const { canvasId } = await params;
  const id = parseId(canvasId);
  if (id === null) return Response.json({ error: "Canvas not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);

  // Validated up front, before anything is written, so a bad `data` can't
  // leave a half-applied update behind (title saved, board not).
  let data = null;
  if ("data" in body) {
    data = sanitizeCanvasData(body.data);
    if (!data) return Response.json({ error: "Invalid canvas data" }, { status: 400 });
  }
  let title: string | null = null;
  if (typeof body.title === "string") {
    title = body.title.trim();
    if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
  }

  if (!(await getCanvas(id))) return Response.json({ error: "Canvas not found" }, { status: 404 });
  if (title !== null) await renameCanvas(id, title);
  if (data) await updateCanvasData(id, data);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { canvasId } = await params;
  const id = parseId(canvasId);
  if (id === null) return Response.json({ error: "Canvas not found" }, { status: 404 });
  await deleteCanvas(id);
  return new Response(null, { status: 204 });
}
