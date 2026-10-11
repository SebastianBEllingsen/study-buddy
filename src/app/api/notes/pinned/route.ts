import { listPinnedNotes } from "@/lib/models";

// The notes pinned to the dashboard's Pinned notes widget.
export async function GET() {
  return Response.json({ notes: await listPinnedNotes() });
}
