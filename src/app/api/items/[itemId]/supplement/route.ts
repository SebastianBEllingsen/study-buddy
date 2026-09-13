import { getGeneratedItem } from "@/lib/models";
import { supplementGeneratedItem, NoNewDocumentsError } from "@/lib/generate";
import { describeAiError } from "@/lib/aiClient";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { itemId } = await params;
  const item = await getGeneratedItem(Number(itemId));
  if (!item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  try {
    const updated = await supplementGeneratedItem(item);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoNewDocumentsError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Supplement failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
