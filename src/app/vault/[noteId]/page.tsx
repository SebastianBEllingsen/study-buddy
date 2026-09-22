"use client";

import { useParams } from "next/navigation";
import NoteWorkspace from "@/components/NoteWorkspace";

export default function NotePage() {
  const params = useParams<{ noteId: string }>();

  return (
    // Full-bleed under the sticky header, Obsidian-style — escapes <main>'s
    // max-w-5xl/padding via the standard relative+negative-margin trick
    // (-my-6/sm:-my-8 exactly cancel main's own py-6/sm:py-8), then sizes
    // itself to fill the rest of the viewport so only the editor scrolls
    // internally instead of the whole page (the header stays put on its own
    // via `sticky`, see layout.tsx, rather than this height being load-
    // bearing for that — it's just here so nothing pushes past one screen).
    <div className="relative left-1/2 -mx-[50vw] -my-6 h-[calc(100dvh-3.5rem)] w-screen sm:-my-8">
      <NoteWorkspace noteId={Number(params.noteId)} />
    </div>
  );
}
