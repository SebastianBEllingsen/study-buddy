import { deleteQuizPreset } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return new Response(null, { status: 204 });
  await deleteQuizPreset(id);
  return new Response(null, { status: 204 });
}
