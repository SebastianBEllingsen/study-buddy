import { createQuizPreset, listQuizPresets } from "@/lib/models";

export async function GET() {
  return Response.json(await listQuizPresets());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const singleChoice = !!body?.settings?.singleChoice;
  const multipleChoice = !!body?.settings?.multipleChoice;
  const shortAnswer = !!body?.settings?.shortAnswer;
  if (!singleChoice && !multipleChoice && !shortAnswer) {
    return Response.json({ error: "At least one question type must be enabled" }, { status: 400 });
  }

  const preset = await createQuizPreset(name, { singleChoice, multipleChoice, shortAnswer });
  return Response.json(preset, { status: 201 });
}
