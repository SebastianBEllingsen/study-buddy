"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import DocumentContent, { type ViewedDocument } from "@/components/DocumentContent";

// Rendered at /documents/[documentId]/view — the "detach" destination for
// DocumentViewer's own dialog (see its handleDetach), popped into its own
// browser window so it can sit alongside the main app window, e.g. for
// taking notes while reading. The root layout's header/max-width shell
// still wraps this route like every other page (there's only the one
// layout) — fixed inset-0 covers it entirely rather than splitting the app
// into route groups for one route.
export default function DetachedDocumentView({ document }: { document: ViewedDocument }) {
  const searchParams = useSearchParams();
  const highlight = searchParams.get("highlight");

  // `window.document`, not the shadowed `document` prop above — identifies
  // this specific popped-out window in the OS taskbar/window switcher,
  // rather than every detached document sharing the app's generic title. A
  // plain synchronous set here can lose a race against the root layout's
  // own async generateMetadata (it resolves server-side and streams the
  // real <title> in after this component's first mount) — deferred to a
  // macrotask so it applies after that settles instead of getting
  // overwritten by it.
  useEffect(() => {
    const timer = setTimeout(() => {
      window.document.title = document.filename;
    }, 0);
    return () => clearTimeout(timer);
  }, [document.filename]);

  // No padding, no filename label, no bordered/rounded box — the point of
  // detaching is a window that's just the document, filling it edge-to-edge
  // (the OS title bar already shows the filename, set above). Compare
  // DocumentViewer's in-dialog rendering, which keeps all of that since it's
  // sharing space with the rest of the app there.
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <DocumentContent document={document} highlight={highlight} bare />
    </div>
  );
}
