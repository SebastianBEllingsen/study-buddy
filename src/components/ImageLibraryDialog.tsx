"use client";

import { useEffect, useState } from "react";
import { ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UploadedImage, UploadedImageKind } from "@/lib/models";

// A reusable "pick from what you've already uploaded" gallery — scoped to
// one image kind (icon vs. cover vs. background; see UploadedImageKind),
// since each has a different crop aspect ratio and picking one for the
// wrong slot would look wrong. Opened from the "…" buttons in
// CustomizeCourseDialog and Settings → Appearance. `onUpload`, when given,
// adds an "Upload new image" button that hands off to the caller's own
// upload-and-crop flow — the "…" is then the one place to change an image,
// whether it's new or reused.
export function ImageLibraryDialog({
  open,
  onOpenChange,
  kind,
  onSelect,
  onUpload,
  imageLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: UploadedImageKind;
  onSelect: (url: string) => void;
  onUpload?: () => void;
  // What the picked image is used as, in the title ("Change link icon
  // image"); defaults to the kind's own name (badge, banner, backdrop).
  imageLabel?: string;
}) {
  const [images, setImages] = useState<UploadedImage[] | null>(null);

  // Reset to the loading state the moment the dialog opens (or re-opens for
  // a different kind) — done during render, comparing against the kind we
  // last fetched for, rather than as a synchronous setState at the top of
  // the effect below (same pattern as CustomizeCourseDialog's own
  // `seededFor`), so the actual fetch stays the only state update inside
  // the effect itself.
  const [loadedFor, setLoadedFor] = useState<UploadedImageKind | null>(null);
  if (open && loadedFor !== kind) {
    setLoadedFor(kind);
    setImages(null);
  }

  useEffect(() => {
    if (!open) return;
    fetch(`/api/uploaded-images?kind=${kind}`)
      .then((r) => r.json())
      .then((body: { images: UploadedImage[] }) => setImages(body.images))
      .catch(() => setImages([]));
  }, [open, kind]);

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    const prev = images;
    setImages((cur) => cur?.filter((img) => img.id !== id) ?? null);
    const res = await fetch(`/api/uploaded-images/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't remove that image");
      setImages(prev);
    }
  }

  function handleSelect(url: string) {
    onSelect(url);
    onOpenChange(false);
  }

  // Called straight from the click (not after the close) — the caller opens
  // a file picker, which browsers only allow during the click itself.
  function handleUpload() {
    onUpload?.();
    onOpenChange(false);
  }

  const aspectClass = kind === "cover" ? "aspect-[3.2/1]" : kind === "background" ? "aspect-[2.1/1]" : "aspect-square";
  const gridClass = kind === "icon" ? "grid-cols-4 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3";
  const kindLabel = imageLabel ?? (kind === "cover" ? "banner" : kind === "background" ? "backdrop" : "badge");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{onUpload ? `Change ${kindLabel} image` : "Choose from previous uploads"}</DialogTitle>
          <DialogDescription>
            {onUpload
              ? `Upload a new image, or reuse a ${kindLabel} image you've uploaded before.`
              : `Reuse a ${kindLabel} image you've already uploaded elsewhere, or close this and upload a new one instead.`}
          </DialogDescription>
        </DialogHeader>
        {onUpload && (
          <Button variant="outline" size="sm" className="self-start" onClick={handleUpload}>
            <ImageIcon className="size-3.5" />
            Upload new image
          </Button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {images === null && (
            <div className={cn("grid gap-2", gridClass)}>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className={cn("rounded-lg", aspectClass)} />
              ))}
            </div>
          )}
          {images && images.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {onUpload
                ? "No previous uploads yet. Images you upload will show up here for reuse."
                : "Nothing here yet — images you upload and crop will show up here for reuse."}
            </p>
          )}
          {images && images.length > 0 && (
            <div className={cn("grid gap-2", gridClass)}>
              {images.map((img) => (
                <div
                  key={img.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(img.url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(img.url);
                    }
                  }}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-lg border bg-cover bg-center outline-none hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary",
                    aspectClass
                  )}
                  style={{ backgroundImage: `url(${img.url})` }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={(e) => handleDelete(img.id, e)}
                    aria-label="Remove from library"
                    className="absolute top-1 right-1 size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
