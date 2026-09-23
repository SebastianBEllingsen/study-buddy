"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Image as ImageIcon, MoreHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { ImageLibraryDialog } from "@/components/ImageLibraryDialog";
import { HelpTooltip } from "@/components/HelpTooltip";
import { describeUploadError, uploadImage } from "@/lib/uploadImage";
import { ICON_CHOICES, COLOR_CHOICES } from "@/lib/pickerChoices";
import {
  ICON_ASPECT,
  ICON_OUTPUT,
  COVER_ASPECT,
  COVER_OUTPUT_WIDTH,
  COVER_OUTPUT_HEIGHT,
  BACKGROUND_ASPECT,
  BACKGROUND_OUTPUT_WIDTH,
  BACKGROUND_OUTPUT_HEIGHT,
} from "@/lib/imageCropPresets";
import type { AppSettings, CourseSummary, UploadedImageKind } from "@/lib/models";
import { FolderChipsPicker } from "@/components/FolderChipsPicker";
import { DEFAULT_FOLDER_CHIPS, parseFolderChipSettings, type FolderChipSettings } from "@/lib/folderChips";

export function CustomizeCourseDialog({
  course,
  open,
  onOpenChange,
  onSaved,
}: {
  course: CourseSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [icon, setIcon] = useState(course.icon);
  const [color, setColor] = useState(course.color);
  const [coverImage, setCoverImage] = useState(course.cover_image);
  const [iconImage, setIconImage] = useState(course.icon_image);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [showCoverOnCard, setShowCoverOnCard] = useState(course.show_cover_on_card);
  const [showIconFrame, setShowIconFrame] = useState(course.show_icon_frame);
  const [showPractice, setShowPractice] = useState(course.show_practice);
  // null == follow the global folder tag setting (Settings → Display).
  const [folderChips, setFolderChips] = useState<FolderChipSettings | null>(() =>
    parseFolderChipSettings(course.folder_chips)
  );
  const { data: globalSettings } = useSWR<AppSettings>("/api/settings");
  const [saving, setSaving] = useState(false);
  const [cropTarget, setCropTarget] = useState<"icon" | "cover" | "background" | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<UploadedImageKind | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  // The dashboard's course list deliberately omits page_background_image
  // (see listCourseSummaries) to avoid pulling every course's large backdrop
  // image on every dashboard load, so this dialog fetches it on demand —
  // only while it's actually open — instead of trusting a field that isn't
  // on the `course` prop at all.
  const { data: bgData } = useSWR<{ pageBackgroundImage: string | null }>(
    open ? `/api/courses/${course.id}/page-background` : null
  );

  // Re-seeds drafts from the course the moment a fresh course id opens the
  // dialog, so a previous open's edits (or a cancel) never leak into a
  // later one. Adjusting state directly during render like this — rather
  // than in an effect — avoids the extra render an effect-based reset would
  // cause; see the react-hooks/set-state-in-effect note in
  // EditFlashcardsDialog.tsx for the same pattern.
  const [seededFor, setSeededFor] = useState(course.id);
  if (open && seededFor !== course.id) {
    setIcon(course.icon);
    setColor(course.color);
    setCoverImage(course.cover_image);
    setIconImage(course.icon_image);
    setShowCoverOnCard(course.show_cover_on_card);
    setShowIconFrame(course.show_icon_frame);
    setShowPractice(course.show_practice);
    setFolderChips(parseFolderChipSettings(course.folder_chips));
    setSeededFor(course.id);
  }

  // backgroundImage is seeded separately, once its own on-demand fetch
  // resolves for the currently open course — it can't be seeded above
  // alongside the rest since it isn't available synchronously from the prop.
  const [bgSeededFor, setBgSeededFor] = useState<number | null>(null);
  if (open && bgData && bgSeededFor !== course.id) {
    setBackgroundImage(bgData.pageBackgroundImage);
    setBgSeededFor(course.id);
  }
  const bgReady = bgSeededFor === course.id;

  async function handleCropped(blob: Blob) {
    if (!cropTarget) return;
    const target = cropTarget;
    try {
      const url = await uploadImage(blob, target);
      if (target === "icon") setIconImage(url);
      else if (target === "cover") setCoverImage(url);
      else if (target === "background") setBackgroundImage(url);
      // Feeds the "Choose from previous uploads" gallery — fire-and-forget,
      // a failed write here shouldn't block using the image you just cropped.
      fetch("/api/uploaded-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: target, url }),
      }).catch(() => {});
    } catch (err) {
      toast.error(describeUploadError(err, "Couldn't upload that image"));
    }
  }

  function handlePickFromLibrary(url: string) {
    if (libraryTarget === "icon") setIconImage(url);
    else if (libraryTarget === "cover") setCoverImage(url);
    else if (libraryTarget === "background") setBackgroundImage(url);
  }

  function handleRemoveCover() {
    setCoverImage(null);
    setShowCoverOnCard(false);
  }

  async function handleSave() {
    // backgroundImage stays null until bgReady, same as its "no backdrop
    // set" value — saving before then would silently wipe a real one, so
    // the Save button is disabled until the fetch resolves (see JSX below).
    if (!bgReady) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          icon,
          color,
          cover_image: coverImage,
          icon_image: iconImage,
          page_background_image: backgroundImage,
          show_cover_on_card: showCoverOnCard,
          show_icon_frame: showIconFrame,
          show_practice: showPractice,
          folder_chips: folderChips,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't save changes");
        return;
      }
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error("Couldn't save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize course</DialogTitle>
          <DialogDescription>
            Pick a badge image or emoji, add a cover banner and page backdrop, and choose a color, to
            make {course.name} easier to spot at a glance.
          </DialogDescription>
        </DialogHeader>

        {/* Badge/emoji picker + cover + color easily add up to more height
            than a short (e.g. half-screen-height) window has to give — same
            fixed-header/scrolling-body split as EditFlashcardsDialog and
            DashboardCustomizeDialog, so the dialog stays fully reachable
            instead of running off both the top and bottom of the
            viewport with no way to scroll to the rest of it. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <div className="space-y-2">
            <Label>Badge image</Label>
            <input
              ref={iconInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCropTarget("icon");
                  setCropFile(file);
                }
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-2">
              {iconImage ? (
                <div
                  className={`relative size-14 shrink-0 overflow-hidden rounded-lg ${showIconFrame ? "border bg-muted" : ""}`}
                  style={
                    showIconFrame
                      ? { backgroundImage: `url(${iconImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                      : {
                          // Checkerboard layered behind the badge shows
                          // through a transparent PNG, the same idea as an
                          // image editor's transparency grid — otherwise
                          // there'd be no way to tell "transparent" apart
                          // from "opaque and happens to match the dialog".
                          backgroundImage: `url(${iconImage}), repeating-conic-gradient(#00000014 0% 25%, transparent 0% 50%)`,
                          backgroundSize: "cover, 8px 8px",
                          backgroundPosition: "center",
                        }
                  }
                >
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="absolute -top-2 -right-2"
                    onClick={() => setIconImage(null)}
                    aria-label="Remove badge image"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => iconInputRef.current?.click()}>
                  <ImageIcon className="size-3.5" />
                  Upload image
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setLibraryTarget("icon")}
                aria-label="Choose a badge image from previous uploads"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </div>
            {iconImage && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={!showIconFrame}
                  onCheckedChange={(checked) => setShowIconFrame(checked !== true)}
                />
                Show as a sticker, without the box behind it
              </label>
            )}
          </div>

          <div className="space-y-2">
            <Label>Emoji icon</Label>
            {iconImage && (
              <p className="text-xs text-muted-foreground">
                Using your badge image above — remove it to use an emoji instead.
              </p>
            )}
            <div className={`grid grid-cols-8 gap-1 ${iconImage ? "pointer-events-none opacity-40" : ""}`}>
              {ICON_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setIcon(icon === choice ? null : choice)}
                  className={`flex size-8 items-center justify-center rounded-md text-base transition-colors hover:bg-muted ${
                    icon === choice ? "bg-muted ring-1 ring-primary" : ""
                  }`}
                  aria-label={`Use ${choice} as icon`}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cover banner</Label>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCropTarget("cover");
                  setCropFile(file);
                }
                e.target.value = "";
              }}
            />
            {coverImage ? (
              <div
                className="relative h-24 rounded-lg border bg-cover bg-center"
                style={{ backgroundImage: `url(${coverImage})` }}
              >
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-1.5 left-1.5"
                  onClick={() => setLibraryTarget("cover")}
                  aria-label="Change cover"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-1.5 right-1.5"
                  onClick={handleRemoveCover}
                  aria-label="Remove cover banner"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => coverInputRef.current?.click()}>
                  <ImageIcon className="size-3.5" />
                  Upload image
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setLibraryTarget("cover")}
                  aria-label="Choose a cover from previous uploads"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </div>
            )}
            {coverImage && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={showCoverOnCard}
                  onCheckedChange={(checked) => setShowCoverOnCard(checked === true)}
                />
                Also show as the background on your course card
              </label>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Page backdrop
              <HelpTooltip>
                A large atmospheric background behind the whole course page, like a game&apos;s
                library page — separate from the cover banner above.
              </HelpTooltip>
            </Label>
            <input
              ref={backgroundInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCropTarget("background");
                  setCropFile(file);
                }
                e.target.value = "";
              }}
            />
            {backgroundImage ? (
              <div
                className="relative h-24 rounded-lg border bg-cover bg-center"
                style={{ backgroundImage: `url(${backgroundImage})` }}
              >
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-1.5 left-1.5"
                  onClick={() => setLibraryTarget("background")}
                  aria-label="Change backdrop"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-1.5 right-1.5"
                  onClick={() => setBackgroundImage(null)}
                  aria-label="Remove page backdrop"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => backgroundInputRef.current?.click()}>
                  <ImageIcon className="size-3.5" />
                  Upload image
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setLibraryTarget("background")}
                  aria-label="Choose a backdrop from previous uploads"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex items-center gap-2">
              {COLOR_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setColor(color === choice.value ? null : choice.value)}
                  className={`size-7 rounded-full ring-offset-2 transition-shadow ${
                    color === choice.value ? "ring-2 ring-primary ring-offset-background" : ""
                  }`}
                  style={{ backgroundColor: choice.value }}
                  aria-label={`Use ${choice.label} as color`}
                />
              ))}
              <label
                className="flex size-7 cursor-pointer items-center justify-center rounded-full border text-xs text-muted-foreground"
                title="Custom color"
              >
                <input
                  type="color"
                  value={color ?? "#888888"}
                  onChange={(e) => setColor(e.target.value)}
                  className="sr-only"
                />
                +
              </label>
              {color && (
                <Button variant="ghost" size="sm" onClick={() => setColor(null)}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Course page</Label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                Show Practice
                <HelpTooltip>The card for generating quizzes, flashcards and notes. Hide it for courses you don&apos;t practice with.</HelpTooltip>
              </span>
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={showPractice}
                onChange={(e) => setShowPractice(e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                Folder tags for this course
                <HelpTooltip>The counts after each folder&apos;s name. Off follows Settings → Display.</HelpTooltip>
              </span>
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={folderChips !== null}
                onChange={(e) =>
                  setFolderChips(e.target.checked ? (globalSettings?.folderChips ?? DEFAULT_FOLDER_CHIPS) : null)
                }
              />
            </label>
            {folderChips ? (
              <div className="rounded-md border p-2.5">
                <FolderChipsPicker value={folderChips} onChange={setFolderChips} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Using the global setting from Settings → Display.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !bgReady}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
      <ImageCropDialog
        open={cropTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setCropTarget(null);
            setCropFile(null);
          }
        }}
        file={cropFile}
        aspect={cropTarget === "cover" ? COVER_ASPECT : cropTarget === "background" ? BACKGROUND_ASPECT : ICON_ASPECT}
        outputWidth={cropTarget === "cover" ? COVER_OUTPUT_WIDTH : cropTarget === "background" ? BACKGROUND_OUTPUT_WIDTH : ICON_OUTPUT}
        outputHeight={cropTarget === "cover" ? COVER_OUTPUT_HEIGHT : cropTarget === "background" ? BACKGROUND_OUTPUT_HEIGHT : ICON_OUTPUT}
        outputFormat={cropTarget === "icon" ? "png" : "jpeg"}
        uploadKind={cropTarget ?? "icon"}
        title={
          cropTarget === "cover"
            ? "Position cover banner"
            : cropTarget === "background"
              ? "Position page backdrop"
              : "Position badge image"
        }
        onCropped={handleCropped}
      />
      <ImageLibraryDialog
        open={libraryTarget !== null}
        onOpenChange={(next) => {
          if (!next) setLibraryTarget(null);
        }}
        kind={libraryTarget ?? "icon"}
        onSelect={handlePickFromLibrary}
        onUpload={() => {
          const input =
            libraryTarget === "cover" ? coverInputRef : libraryTarget === "background" ? backgroundInputRef : iconInputRef;
          input.current?.click();
        }}
      />
    </>
  );
}
