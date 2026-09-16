import crypto from "node:crypto";
import { blobStore } from "@/lib/blobStorage";
import { IMAGE_EXTENSION_BY_MIME } from "@/lib/blobStorage/imageTypes";
import {
  listCourses,
  updateCourseCustomization,
  getAppSettings,
  setAppBranding,
  listAllUploadedImages,
  updateUploadedImageUrl,
} from "@/lib/models";

// One-time backfill: rewrites every existing base64 data: URL image (course
// covers/icons/backdrops, app branding, the uploaded-images library) into a
// real blob-storage URL, using whichever backend is currently active (unlike
// ../migrate/route.ts, which always pushes local -> a given connection
// string regardless of the active mode — this instead operates on "the
// database and blob store the app is using right now").
//
// Idempotent: parseDataUrl below only matches values that still literally
// start with "data:", so already-migrated rows (or rows that were always
// null) are left untouched and it's safe to run more than once, including
// after uploading more images normally in between runs.
//
// IMPORTANT: this reads every matching row's full base64 image out of the
// database to re-upload it — itself a real one-time egress cost against
// whichever database is currently active. Do not run this against a
// Supabase-backed database while close to or over its egress cap; a dry run
// against local SQLite first (zero egress) is a safe way to verify it works
// before pointing it at Supabase.

function parseDataUrl(value: string | null): { bytes: Buffer; contentType: string; extension: string } | null {
  if (!value) return null;
  const match = value.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const [, contentType, base64] = match;
  const extension = IMAGE_EXTENSION_BY_MIME.get(contentType);
  if (!extension) return null;
  return { bytes: Buffer.from(base64, "base64"), contentType, extension };
}

async function migrateOne(kind: string, value: string | null): Promise<string | null> {
  const parsed = parseDataUrl(value);
  if (!parsed || !blobStore) return null;
  const key = `${kind}/${crypto.randomUUID()}${parsed.extension}`;
  const result = await blobStore.put(key, parsed.bytes, parsed.contentType);
  return result?.url ?? null;
}

export async function POST() {
  if (!blobStore) {
    return Response.json(
      { error: "Configure Supabase Storage (URL, service key, bucket) in Settings first" },
      { status: 400 }
    );
  }

  let coursesMigrated = 0;
  for (const course of await listCourses()) {
    const fields: Parameters<typeof updateCourseCustomization>[1] = {};
    const cover = await migrateOne("cover", course.cover_image);
    if (cover) fields.cover_image = cover;
    const icon = await migrateOne("icon", course.icon_image);
    if (icon) fields.icon_image = icon;
    const background = await migrateOne("background", course.page_background_image);
    if (background) fields.page_background_image = background;
    if (Object.keys(fields).length > 0) {
      await updateCourseCustomization(course.id, fields);
      coursesMigrated++;
    }
  }

  let brandingMigrated = false;
  const settings = await getAppSettings();
  const brandingFields: Parameters<typeof setAppBranding>[0] = {};
  const appIcon = await migrateOne("app-icon", settings.appIconImage);
  if (appIcon) brandingFields.appIconImage = appIcon;
  const dashboardBackground = await migrateOne("dashboard-background", settings.dashboardBackgroundImage);
  if (dashboardBackground) brandingFields.dashboardBackgroundImage = dashboardBackground;
  if (Object.keys(brandingFields).length > 0) {
    await setAppBranding(brandingFields);
    brandingMigrated = true;
  }

  let imagesMigrated = 0;
  for (const image of await listAllUploadedImages()) {
    const url = await migrateOne(image.kind, image.url);
    if (url) {
      await updateUploadedImageUrl(image.id, url);
      imagesMigrated++;
    }
  }

  return Response.json({ coursesMigrated, brandingMigrated, imagesMigrated });
}
