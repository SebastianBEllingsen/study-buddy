import { getGeneratedItem } from "@/lib/models";
import { supplementGeneratedItem, NoNewDocumentsError } from "@/lib/generate";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Item not found" }, { status: 404 });
  const item = await getGeneratedItem(id);
  if (!item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  try {
    const updated = await supplementGeneratedItem(item);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoNewDocumentsError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Supplement failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
