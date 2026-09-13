import { NextRequest } from "next/server";
import { createCourse, listCourses } from "@/lib/models";

export async function GET() {
  return Response.json(await listCourses());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Course name is required" }, { status: 400 });
  }
  const course = await createCourse(name);
  return Response.json(course, { status: 201 });
}
