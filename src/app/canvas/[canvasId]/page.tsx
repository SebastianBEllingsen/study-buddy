"use client";

import { useParams } from "next/navigation";
import CanvasWorkspace from "@/components/canvas/CanvasWorkspace";

export default function CanvasPage() {
  const params = useParams<{ canvasId: string }>();

  return (
    // Full-bleed under the sticky header — same escape-<main> trick as
    // /vault/[noteId] (see its comment), so the board fills the viewport
    // and only it pans, never the page.
    <div className="relative left-1/2 -mx-[50vw] -my-6 h-[calc(100dvh-3.5rem)] w-screen sm:-my-8">
      <CanvasWorkspace canvasId={Number(params.canvasId)} />
    </div>
  );
}
