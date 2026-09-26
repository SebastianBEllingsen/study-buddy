import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { verifyLink } from "@/lib/linkVerifier";
import { deleteResource, getResourceRow, setResourceLinkCheck, updateResource } from "@/lib/studyPlan/store";
import { findResourceInPlan } from "@/lib/studyPlan/ownership";
import { parseResourcePatch } from "@/lib/studyPlan/requestParsing";

type Params = { params: Promise<{ planId: string; resourceId: string }> };

async function resolve(params: Params["params"]) {
  const { planId, resourceId } = await params;
  const planIdNum = parseId(planId);
  const resourceIdNum = parseId(resourceId);
  if (planIdNum === null || resourceIdNum === null) return null;
  return findResourceInPlan(planIdNum, resourceIdNum);
}

export async function PATCH(request: Request, { params }: Params) {
  const resource = await resolve(params);
  if (!resource) return Response.json({ error: "Resource not found" }, { status: 404 });
  const parsed = parseResourcePatch(await parseJsonObjectBody(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  await updateResource(resource.id, parsed.value);
  // A changed link gets checked right away, same as adding one.
  if (parsed.value.url && parsed.value.url !== resource.url) {
    const check = await verifyLink(parsed.value.url, parsed.value.kind ?? resource.kind);
    await setResourceLinkCheck(resource.id, { status: check.status, detail: check.detail, url: check.finalUrl });
  }
  return Response.json({ resource: await getResourceRow(resource.id) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const resource = await resolve(params);
  if (!resource) return Response.json({ error: "Resource not found" }, { status: 404 });
  await deleteResource(resource.id);
  return Response.json({ ok: true });
}
