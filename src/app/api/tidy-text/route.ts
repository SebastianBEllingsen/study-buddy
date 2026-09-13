import { tidyPastedText } from "@/lib/tidyText";
import { describeAiError } from "@/lib/aiClient";

// Cleans up text before it's saved anywhere — used by the "Paste text"
// dialog's "Make pretty" button, which has no document to attach to yet.
// See documents/[documentId]/tidy/route.ts for re-tidying an already-saved
// pasted document.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return Response.json({ error: "Nothing to tidy" }, { status: 400 });
    }

    const tidied = await tidyPastedText(text);
    return Response.json({ text: tidied });
  } catch (err) {
    console.error("Tidying text failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
