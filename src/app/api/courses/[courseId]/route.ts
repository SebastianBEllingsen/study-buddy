import fs from "node:fs/promises";
import {
  deleteCourse,
  getCourse,
  listCanvasesForCourse,
  listDocumentSummariesForCourse,
  listFoldersForCourse,
  listGeneratedItemSummariesForCourse,
  listNotesForCourse,
  renameCourse,
  updateCourseCustomization,
} from "@/lib/models";
import { isValidCoverImage, isValidIconImage, isValidPageBackgroundImage } from "@/lib/dataUrlImage";
import { cleanupReplacedImage } from "@/lib/blobStorage/cleanup";
import { parseId } from "@/lib/routeParams";
import { courseUploadsDirPath } from "@/lib/uploads";
import { isValidIcon, isValidColor } from "@/lib/fieldValidation";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const course = await getCourse(id);
  if (!course) {
    return Response.json({ error: "Course not found" }, { status: 404 });
  }
  const [folders, documents, items, notes, canvases] = await Promise.all([
    listFoldersForCourse(id),
    listDocumentSummariesForCourse(id),
    listGeneratedItemSummariesForCourse(id),
    listNotesForCourse(id),
    listCanvasesForCourse(id),
  ]);
  return Response.json({ course, folders, documents, items, notes, canvases });
}

export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  // Captured before the update so a replaced/cleared image's old blob can
  // be cleaned up afterward (see the cleanupReplacedImage calls below) —
  // undefined if the course doesn't exist, in which case there's nothing to
  // clean up either.
  const existing = await getCourse(id);

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return Response.json({ error: "Course name is required" }, { status: 400 });
    }
    await renameCourse(id, name);
  }

  const customization: {
    icon?: string | null;
    color?: string | null;
    cover_image?: string | null;
    icon_image?: string | null;
    page_background_image?: string | null;
    show_cover_on_card?: boolean;
    show_icon_frame?: boolean;
  } = {};
  if ("icon" in body) {
    // A handful of grapheme clusters at most — plenty for an emoji, even a
    // multi-codepoint one (skin tone modifiers, ZWJ sequences).
    if (body.icon !== null && !isValidIcon(body.icon)) {
      return Response.json({ error: "Invalid icon" }, { status: 400 });
    }
    customization.icon = body.icon as string | null;
  }
  if ("color" in body) {
    if (body.color !== null && !isValidColor(body.color)) {
      return Response.json({ error: "Invalid color" }, { status: 400 });
    }
    customization.color = body.color as string | null;
  }
  if ("cover_image" in body) {
    if (body.cover_image !== null && !isValidCoverImage(body.cover_image)) {
      return Response.json({ error: "Invalid cover image" }, { status: 400 });
    }
    customization.cover_image = body.cover_image as string | null;
  }
  if ("icon_image" in body) {
    if (body.icon_image !== null && !isValidIconImage(body.icon_image)) {
      return Response.json({ error: "Invalid icon image" }, { status: 400 });
    }
    customization.icon_image = body.icon_image as string | null;
  }
  if ("page_background_image" in body) {
    if (body.page_background_image !== null && !isValidPageBackgroundImage(body.page_background_image)) {
      return Response.json({ error: "Invalid page background image" }, { status: 400 });
    }
    customization.page_background_image = body.page_background_image as string | null;
  }
  if ("show_cover_on_card" in body) {
    if (typeof body.show_cover_on_card !== "boolean") {
      return Response.json({ error: "Invalid show_cover_on_card" }, { status: 400 });
    }
    customization.show_cover_on_card = body.show_cover_on_card;
  }
  if ("show_icon_frame" in body) {
    if (typeof body.show_icon_frame !== "boolean") {
      return Response.json({ error: "Invalid show_icon_frame" }, { status: 400 });
    }
    customization.show_icon_frame = body.show_icon_frame;
  }
  if (Object.keys(customization).length > 0) {
    await updateCourseCustomization(id, customization);
  }

  // After the write, not before — cleanupReplacedImage's "is this URL still
  // referenced anywhere" check needs this course's own row already holding
  // its new value, or the old value would always look self-referenced.
  if (existing) {
    await Promise.all([
      "cover_image" in customization
        ? cleanupReplacedImage(existing.cover_image, customization.cover_image)
        : Promise.resolve(),
      "icon_image" in customization
        ? cleanupReplacedImage(existing.icon_image, customization.icon_image)
        : Promise.resolve(),
      "page_background_image" in customization
        ? cleanupReplacedImage(existing.page_background_image, customization.page_background_image)
        : Promise.resolve(),
    ]);
  }

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const existing = await getCourse(id);
  await deleteCourse(id);
  if (existing) {
    await Promise.all([
      cleanupReplacedImage(existing.cover_image),
      cleanupReplacedImage(existing.icon_image),
      cleanupReplacedImage(existing.page_background_image),
    ]);
  }
  // The DB rows (documents, their file_path/preview cache) are gone once
  // deleteCourse's cascade runs, so this is the last point anything can
  // still find them — remove the whole per-course upload directory in one
  // shot rather than trying to individually fs.rm each document's file
  // (mirrors the single-document DELETE route's cleanup, but for the
  // directory as a whole since there's no longer a document row to read a
  // path from). Best-effort: a failure here just leaves orphaned files,
  // same as today, not a reason to fail the course deletion itself.
  await fs.rm(courseUploadsDirPath(id), { recursive: true, force: true }).catch(() => {});
  return new Response(null, { status: 204 });
}
