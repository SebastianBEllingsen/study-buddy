"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import type { ViewedDocument } from "@/components/DocumentContent";
import DetachedDocumentView from "@/components/DetachedDocumentView";

interface DocumentDetail {
  document: ViewedDocument;
}

// The "detach" destination for DocumentViewer's own dialog (see its
// handleDetach) — a real, separate browser window/tab holding just this
// document, so it can sit alongside the main app window (e.g. for taking
// notes while reading) instead of only ever living inside a modal.
export default function DetachedDocumentPage() {
  const params = useParams<{ documentId: string }>();
  const { data, error } = useSWR<DocumentDetail>(`/api/documents/${params.documentId}`);

  if (error) {
    return (
      <div data-slot="detached-page" className="fixed inset-0 z-50 flex items-center justify-center bg-background text-sm text-muted-foreground">
        This document doesn&apos;t exist anymore.
      </div>
    );
  }

  if (!data) {
    return (
      <div data-slot="detached-page" className="fixed inset-0 z-50 flex items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <DetachedDocumentView document={data.document} />;
}
