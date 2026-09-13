import { listLinkTargets } from "@/lib/models";

// Powers the Vault editor's "[[" note completion and its "Insert link"
// dialog for documents/generated items — see lib/models.ts's
// listLinkTargets for why this is one small full listing rather than a
// search-as-you-type endpoint.
export async function GET() {
  return Response.json(await listLinkTargets());
}
