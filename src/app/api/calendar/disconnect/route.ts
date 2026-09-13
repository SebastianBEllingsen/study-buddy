import { disconnectGoogleCalendar } from "@/lib/models";

export async function POST() {
  await disconnectGoogleCalendar();
  return Response.json({ ok: true });
}
