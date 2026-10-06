import { exportAllData } from "@/lib/exportData";

// A student-facing safety net, not a system backup (that's the daily backup
// in Settings → Storage): everything that's expensive to lose as one
// downloadable JSON file. What goes in, and what is left out, is described
// in lib/exportData.ts.
export async function GET() {
  try {
    const payload = await exportAllData();
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="study-buddy-export-${payload.exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    console.error("Export failed:", err);
    return Response.json({ error: "Couldn't export your data" }, { status: 500 });
  }
}
