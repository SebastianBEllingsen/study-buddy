"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

// Lets the user pan/zoom an uploaded image inside a fixed-aspect-ratio
// viewport, then bakes exactly what's visible into a canvas at a fixed
// output size. Used for both course icon (square) and cover (wide) uploads
// — previously those force-cropped the image's center via a plain resize,
// giving no control over which part of a wide/tall source photo survives.
export function ImageCropDialog({
  open,
  onOpenChange,
  file,
  aspect,
  outputWidth,
  outputHeight,
  outputFormat = "jpeg",
  title,
  onCropped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  aspect: number; // viewport width / height
  outputWidth: number;
  outputHeight: number;
  // "png" preserves transparency (needed for a badge/sticker-style icon
  // over a background image) — "jpeg" (the default) always flattens to an
  // opaque background, which is fine and much smaller for a cover photo.
  outputFormat?: "jpeg" | "png";
  title: string;
  onCropped: (dataUrl: string) => void;
}) {
  // A callback ref (not a plain ref read inside an effect keyed on `open`)
  // because Dialog mounts its content one render after `open` flips true —
  // an effect depending only on `[open]` would fire while the div is still
  // unattached and never get a chance to re-run once it exists. A callback
  // ref fires exactly when the node itself attaches, whenever that happens.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [baking, setBaking] = useState(false);

  // Loads the picked file the moment the dialog opens for it, and resets
  // zoom/pan so a previous image's framing never leaks into a new one.
  useEffect(() => {
    if (!open || !file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setImgEl(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [open, file]);

  // The viewport's real CSS size — fixed aspect ratio, but its width
  // follows the dialog's own responsive width, so measure rather than
  // assume a pixel value. Keyed on the element itself (see viewportEl's
  // comment above), not on `open`.
  useEffect(() => {
    if (!viewportEl) return;
    const measure = () => setViewportSize({ width: viewportEl.clientWidth, height: viewportEl.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  // "Cover" fit at zoom 1 (image always fully fills the viewport, cropped
  // rather than letterboxed), then zoom scales up from there.
  const baseScale =
    naturalSize.width > 0 && viewportSize.width > 0
      ? Math.max(viewportSize.width / naturalSize.width, viewportSize.height / naturalSize.height)
      : 0;
  const totalScale = baseScale * zoom;
  const dispWidth = naturalSize.width * totalScale;
  const dispHeight = naturalSize.height * totalScale;

  function clampOffset(x: number, y: number) {
    const minX = Math.min(0, viewportSize.width - dispWidth);
    const minY = Math.min(0, viewportSize.height - dispHeight);
    return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
  }

  // Clamped fresh every render (rather than synced into state via an
  // effect) so a zoom-out or viewport resize can never leave stale,
  // out-of-range stored coordinates on screen even for one frame — the
  // stored `offset` itself only gets corrected lazily, on the next drag.
  const displayOffset = clampOffset(offset.x, offset.y);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (dispWidth <= 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startOffset = offset;
    function onMove(ev: PointerEvent) {
      setOffset(clampOffset(startOffset.x + (ev.clientX - startX), startOffset.y + (ev.clientY - startY)));
    }
    function onUp() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  async function handleConfirm() {
    if (!imgEl || dispWidth <= 0) return;
    setBaking(true);
    try {
      const sx = -displayOffset.x / totalScale;
      const sy = -displayOffset.y / totalScale;
      const sw = viewportSize.width / totalScale;
      const sh = viewportSize.height / totalScale;
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
      onCropped(
        outputFormat === "png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85)
      );
      onOpenChange(false);
    } catch {
      toast.error("Couldn't process that image");
    } finally {
      setBaking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Drag to reposition, and zoom to fit what you want in frame.</DialogDescription>
        </DialogHeader>

        <div
          ref={setViewportEl}
          className="relative touch-none overflow-hidden rounded-lg border bg-muted select-none"
          style={{ aspectRatio: aspect }}
          onPointerDown={handlePointerDown}
        >
          {imgEl && dispWidth > 0 && (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL of a locally-picked file, not a next/image-optimizable asset
            <img
              src={imgEl.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none cursor-grab select-none"
              style={{
                width: dispWidth,
                height: dispHeight,
                transform: `translate(${displayOffset.x}px, ${displayOffset.y}px)`,
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={baking || !imgEl}>
            {baking ? "Saving…" : "Use this crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
