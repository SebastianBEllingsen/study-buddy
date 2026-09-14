import { deleteQuizPreset } from "@/lib/models";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await deleteQuizPreset(Number(id));
  return new Response(null, { status: 204 });
}
