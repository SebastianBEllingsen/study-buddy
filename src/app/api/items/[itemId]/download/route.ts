import { getGeneratedItem } from "@/lib/models";
import { renderQuizHtml } from "@/lib/quizExport";
import type { QuizContent } from "@/lib/types";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ itemId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { itemId } = await params;
  const id = parseId(itemId);
  if (id === null) return Response.json({ error: "Quiz item not found" }, { status: 404 });
  const item = await getGeneratedItem(id);
  if (!item || item.mode !== "quiz") {
    return Response.json({ error: "Quiz item not found" }, { status: 404 });
  }

  const content = JSON.parse(item.content_json) as QuizContent;
  const html = renderQuizHtml(item.title, content);
  // Strips anything that isn't filesystem-safe — a quiz title carrying a
  // "/" (e.g. "Notes — Course (Folder/Subfolder)") would otherwise land in
  // the Content-Disposition header as a literal path segment.
  const filename = `${item.title.replace(/[^\w\- ]+/g, "").trim() || "quiz"}.html`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
