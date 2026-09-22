"use client";

import { useParams } from "next/navigation";
import NoteWorkspace from "@/components/NoteWorkspace";

// The "detach" destination for NoteWorkspace's own Detach button (see
// handleDetach there) — a real, separate browser window holding just this
// note, so it can sit alongside the course page (or anywhere else) instead
// of only ever living inside the main app tab. Mirrors
// documents/[documentId]/view: the root layout's header/max-width shell
// still wraps this route like every other page (there's only the one
// layout) — fixed inset-0 covers it entirely rather than splitting the app
// into route groups for one route.
export default function DetachedNotePage() {
  const params = useParams<{ noteId: string }>();

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <NoteWorkspace noteId={Number(params.noteId)} detached />
    </div>
  );
}
