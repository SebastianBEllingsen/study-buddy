import { getGeneratedItem, getCourse } from "@/lib/models";
import { askAi } from "@/lib/askAi";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Item not found" }, { status: 404 });
  const item = await getGeneratedItem(id);
  if (!item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  const course = await getCourse(item.course_id);
  const courseName = course?.name ?? "this course";
  const body = await request.json().catch(() => ({}));
  return askAi(courseName, body);
}
