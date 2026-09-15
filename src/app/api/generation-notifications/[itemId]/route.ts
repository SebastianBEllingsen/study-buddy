import { dismissGenerationNotification } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

// Called both by the popup's own dismiss/X button and by the items/[itemId]
// page on load (opening the item counts as acknowledging it too) — see
// dismissGenerationNotification for why a repeat call here is harmless.
export async function DELETE(_request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return new Response(null, { status: 204 });
  await dismissGenerationNotification(id);
  return new Response(null, { status: 204 });
}
