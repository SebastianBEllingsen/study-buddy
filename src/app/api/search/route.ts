import { searchAll } from "@/lib/models";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const courseIdParam = searchParams.get("courseId");
  const courseId =
    courseIdParam && Number.isInteger(Number(courseIdParam)) ? Number(courseIdParam) : undefined;

  if (q.length < 2) {
    return Response.json({ results: [] });
  }

  return Response.json({ results: await searchAll(q, courseId) });
}
