import {
  deleteCourse,
  getCourse,
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

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const course = await getCourse(id);
  if (!course) {
    return Response.json({ error: "Course not found" }, { status: 404 });
  }
  const [folders, documents, items, notes] = await Promise.all([
    listFoldersForCourse(id),
    listDocumentSummariesForCourse(id),
    listGeneratedItemSummariesForCourse(id),
    listNotesForCourse(id),
  ]);
  return Response.json({ course, folders, documents, items, notes });
}

export async function PATCH(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  // Captured before the update so a replaced/cleared image's old blob can
  // be cleaned up afterward (see the cleanupReplacedImage calls below) —
  // undefined if the course doesn't exist, in which case there's nothing to
  // clean up either.
  const existing = await getCourse(id);

  if (typeof body?.name === "string") {
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
    if (body.icon !== null && (typeof body.icon !== "string" || body.icon.length > 16)) {
      return Response.json({ error: "Invalid icon" }, { status: 400 });
    }
    customization.icon = body.icon;
  }
  if ("color" in body) {
    if (body.color !== null && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
      return Response.json({ error: "Invalid color" }, { status: 400 });
    }
    customization.color = body.color;
  }
  if ("cover_image" in body) {
    if (body.cover_image !== null && !isValidCoverImage(body.cover_image)) {
      return Response.json({ error: "Invalid cover image" }, { status: 400 });
    }
    customization.cover_image = body.cover_image;
  }
  if ("icon_image" in body) {
    if (body.icon_image !== null && !isValidIconImage(body.icon_image)) {
      return Response.json({ error: "Invalid icon image" }, { status: 400 });
    }
    customization.icon_image = body.icon_image;
  }
  if ("page_background_image" in body) {
    if (body.page_background_image !== null && !isValidPageBackgroundImage(body.page_background_image)) {
      return Response.json({ error: "Invalid page background image" }, { status: 400 });
    }
    customization.page_background_image = body.page_background_image;
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
  return new Response(null, { status: 204 });
}
