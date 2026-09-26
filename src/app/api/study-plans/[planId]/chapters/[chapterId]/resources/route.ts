import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { verifyLink } from "@/lib/linkVerifier";
import { nowUtc } from "@/lib/time";
import { addResource } from "@/lib/studyPlan/store";
import { findChapterInPlan } from "@/lib/studyPlan/ownership";
import { parseNewResource } from "@/lib/studyPlan/requestParsing";

type Params = { params: Promise<{ planId: string; chapterId: string }> };

// Adds a hand-picked link. It's checked right away, but kept whatever the
// verdict — the user chose it, so a dead/blocked link is saved with its
// badge and reason rather than refused.
export async function POST(request: Request, { params }: Params) {
  const { planId, chapterId } = await params;
  const planIdNum = parseId(planId);
  const chapterIdNum = parseId(chapterId);
  const chapter =
    planIdNum === null || chapterIdNum === null ? null : await findChapterInPlan(planIdNum, chapterIdNum);
  if (!chapter) return Response.json({ error: "Chapter not found" }, { status: 404 });

  const parsed = parseNewResource(await parseJsonObjectBody(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const check = await verifyLink(parsed.value.url, parsed.value.kind);
  const resource = await addResource(chapter.id, {
    ...parsed.value,
    url: check.finalUrl,
    provider: null,
    language: null,
    origin: "user",
    link_status: check.status,
    status_detail: check.detail,
    checked_at: nowUtc(),
  });
  return Response.json({ resource }, { status: 201 });
}
