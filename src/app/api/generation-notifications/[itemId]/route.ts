import { dismissGenerationNotification } from "@/lib/models";

type Params = { params: Promise<{ itemId: string }> };

// Called both by the popup's own dismiss/X button and by the items/[itemId]
// page on load (opening the item counts as acknowledging it too) — see
// dismissGenerationNotification for why a repeat call here is harmless.
export async function DELETE(_request: Request, { params }: Params) {
  const { itemId } = await params;
  await dismissGenerationNotification(Number(itemId));
  return new Response(null, { status: 204 });
}
