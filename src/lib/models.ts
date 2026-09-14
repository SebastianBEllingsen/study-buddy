import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import Fuse from "fuse.js";
import {
  db,
  app_settings,
  calendar_feeds,
  completed_assignments,
  courses,
  documents,
  flashcard_reviews,
  flashcard_schedule,
  folders,
  generated_items,
  generation_notifications,
  notes,
  quiz_attempts,
  recent_views,
  runTransaction,
  uploaded_images,
} from "./db";
import { nowUtc } from "./time";
import type { QuizContent, FlashcardsContent, NotesContent } from "./types";
import { computeDueCardIndices } from "./spacedRepetition";
import { omitEmbeddedImages } from "./embeddedImages";
import { parseNoteLinks, stripNoteLinkSyntax } from "./noteLinks";

export type DocumentStatus = "pending" | "extracted" | "failed";
export type GenerationMode = "notes" | "quiz" | "flashcards";
export type FlashcardResult = "again" | "hard" | "good" | "easy";

export interface Course {
  id: number;
  name: string;
  position: number;
  icon: string | null;
  color: string | null;
  cover_image: string | null;
  icon_image: string | null;
  page_background_image: string | null;
  show_cover_on_card: boolean;
  show_icon_frame: boolean;
  created_at: string;
}

export interface Folder {
  id: number;
  course_id: number;
  name: string;
  is_master: boolean;
  position: number;
  // Non-null means this folder is a subfolder of another. One level of
  // nesting only — a subfolder's own parent_folder_id is always null, and
  // createFolder rejects nesting a subfolder under another subfolder.
  parent_folder_id: number | null;
  icon: string | null;
  color: string | null;
  created_at: string;
}

export class CannotDeleteMasterFolderError extends Error {
  constructor() {
    super("This root folder can't be deleted.");
    this.name = "CannotDeleteMasterFolderError";
  }
}

export class CannotNestSubfolderError extends Error {
  constructor() {
    super("Subfolders can't contain their own subfolders.");
    this.name = "CannotNestSubfolderError";
  }
}

// Every document and every generated item always belongs to a real folder —
// folder_id is never NULL from the application. A pooled ("All course
// material") generation still lands in the course's default folder; see
// lib/generate.ts.
export interface DocumentRow {
  id: number;
  course_id: number;
  folder_id: number;
  position: number;
  filename: string;
  file_path: string;
  extracted_text: string | null;
  page_count: number | null;
  char_count: number | null;
  status: DocumentStatus;
  error_message: string | null;
  created_at: string;
}

export interface GeneratedItem {
  id: number;
  course_id: number;
  folder_id: number;
  position: number;
  mode: GenerationMode;
  title: string;
  content_json: string;
  source_document_ids: string;
  // The folder actually generated from — null means "all course material"
  // (pooled across every folder). See schema.sql for why this differs from
  // folder_id (where the item is filed).
  source_folder_id: number | null;
  // Which AI backend/model produced this item — null for items generated
  // before this was tracked. See lib/aiClient.ts's getModelInfo().
  model_provider: AiBackend | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizAttempt {
  id: number;
  generated_item_id: number;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  answers_json: string | null;
}

// --- App settings ---

export type AiBackend = "api" | "claude_code" | "codex_cli" | "openai" | "gemini" | "free";

export type AiProviderKeyName = "anthropic" | "openai" | "gemini" | "openrouter";

interface SettingsRow {
  ai_provider: AiBackend;
  anthropic_api_key: string | null;
  openai_api_key: string | null;
  gemini_api_key: string | null;
  openrouter_api_key: string | null;
  show_model_badge: boolean;
  google_client_id: string | null;
  google_client_secret: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_token_expiry: string | null;
  home_widgets: string | null;
  auto_open_generated_items: boolean;
  app_name: string | null;
  app_icon: string | null;
  app_icon_image: string | null;
  app_font: string | null;
  dashboard_background_image: string | null;
  dashboard_banner_style: string | null;
}

async function getSettingsRow(): Promise<SettingsRow | undefined> {
  const rows = await db
    .select({
      ai_provider: app_settings.ai_provider,
      anthropic_api_key: app_settings.anthropic_api_key,
      openai_api_key: app_settings.openai_api_key,
      gemini_api_key: app_settings.gemini_api_key,
      openrouter_api_key: app_settings.openrouter_api_key,
      show_model_badge: app_settings.show_model_badge,
      google_client_id: app_settings.google_client_id,
      google_client_secret: app_settings.google_client_secret,
      google_access_token: app_settings.google_access_token,
      google_refresh_token: app_settings.google_refresh_token,
      google_token_expiry: app_settings.google_token_expiry,
      home_widgets: app_settings.home_widgets,
      auto_open_generated_items: app_settings.auto_open_generated_items,
      app_name: app_settings.app_name,
      app_icon: app_settings.app_icon,
      app_icon_image: app_settings.app_icon_image,
      app_font: app_settings.app_font,
      dashboard_background_image: app_settings.dashboard_background_image,
      dashboard_banner_style: app_settings.dashboard_banner_style,
    })
    .from(app_settings)
    .where(eq(app_settings.id, 1))
    .limit(1);
  return rows[0];
}

export async function getAiBackend(): Promise<AiBackend> {
  const row = await getSettingsRow();
  return row?.ai_provider ?? "api";
}

export async function setAiBackend(backend: AiBackend): Promise<void> {
  await db
    .update(app_settings)
    .set({ ai_provider: backend, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

// Only called server-side from within lib/aiBackends/* — never exposed
// through the settings API route, which only ever returns presence flags
// (see getAppSettings below), not raw key values.
export async function getProviderKey(name: AiProviderKeyName): Promise<string | null> {
  const row = await getSettingsRow();
  if (!row) return null;
  const byName: Record<AiProviderKeyName, string | null> = {
    anthropic: row.anthropic_api_key,
    openai: row.openai_api_key,
    gemini: row.gemini_api_key,
    openrouter: row.openrouter_api_key,
  };
  return byName[name] ?? null;
}

export async function setProviderKey(name: AiProviderKeyName, key: string | null): Promise<void> {
  const value = key && key.trim() ? key.trim() : null;
  const updated_at = nowUtc();
  switch (name) {
    case "anthropic":
      await db.update(app_settings).set({ anthropic_api_key: value, updated_at }).where(eq(app_settings.id, 1));
      return;
    case "openai":
      await db.update(app_settings).set({ openai_api_key: value, updated_at }).where(eq(app_settings.id, 1));
      return;
    case "gemini":
      await db.update(app_settings).set({ gemini_api_key: value, updated_at }).where(eq(app_settings.id, 1));
      return;
    case "openrouter":
      await db.update(app_settings).set({ openrouter_api_key: value, updated_at }).where(eq(app_settings.id, 1));
      return;
  }
}

export interface AppSettings {
  aiBackend: AiBackend;
  hasAnthropicKey: boolean;
  hasOpenAiKey: boolean;
  hasGeminiKey: boolean;
  hasOpenRouterKey: boolean;
  showModelBadge: boolean;
  hasGoogleClientCredentials: boolean;
  googleCalendarConnected: boolean;
  hasCalendarFeeds: boolean;
  homeWidgets: HomeWidgetConfig[];
  // On (the default): finishing a generation navigates straight to it, same
  // as before this setting existed. Off: it stays on the course page and a
  // generation_notifications row is created instead — see
  // createGenerationNotification and the generate route.
  autoOpenGeneratedItems: boolean;
  // App-wide rebrand — all null means the built-in "Study Buddy" identity.
  // appIcon is a single emoji; appIconImage is an uploaded image data URL
  // (same icon/icon_image split as course customization) and takes priority
  // over appIcon when both are set, matching that same priority order.
  appName: string | null;
  appIcon: string | null;
  appIconImage: string | null;
  // A key into the curated font list (see lib/fontChoices.ts — kept out of
  // this server-only file so client components can import the list without
  // pulling in the DB layer) — null means "use whichever font the active
  // appearance theme already picks."
  appFont: string | null;
  // A Steam-library-style full-bleed backdrop behind the home dashboard —
  // same idea/shape as a course's own page_background_image, just app-wide.
  dashboardBackgroundImage: string | null;
  // How the dashboard widgets sit relative to that backdrop, when there is
  // one — "overlap" (default): the widget grid shifts up so its top row
  // dips into the bottom of the banner, like a Steam/Netflix hero banner.
  // "backdrop": the banner spans the full dashboard section (heading +
  // every widget row), with all of it rendered on top throughout, not just
  // the top edge. Meaningless with no dashboardBackgroundImage set.
  dashboardBannerStyle: "overlap" | "backdrop";
}

export async function getAppSettings(): Promise<AppSettings> {
  const row = await getSettingsRow();
  const feeds = await listCalendarFeeds();
  return {
    aiBackend: row?.ai_provider ?? "api",
    hasAnthropicKey: !!row?.anthropic_api_key,
    hasOpenAiKey: !!row?.openai_api_key,
    hasGeminiKey: !!row?.gemini_api_key,
    hasOpenRouterKey: !!row?.openrouter_api_key,
    showModelBadge: row?.show_model_badge ?? true,
    hasGoogleClientCredentials: !!row?.google_client_id && !!row?.google_client_secret,
    googleCalendarConnected: !!row?.google_refresh_token,
    hasCalendarFeeds: feeds.length > 0,
    homeWidgets: parseHomeWidgets(row?.home_widgets ?? null),
    autoOpenGeneratedItems: row?.auto_open_generated_items ?? true,
    appName: row?.app_name ?? null,
    appIcon: row?.app_icon ?? null,
    appIconImage: row?.app_icon_image ?? null,
    appFont: row?.app_font ?? null,
    dashboardBackgroundImage: row?.dashboard_background_image ?? null,
    dashboardBannerStyle: row?.dashboard_banner_style === "backdrop" ? "backdrop" : "overlap",
  };
}

export async function setShowModelBadge(show: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ show_model_badge: show, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setAutoOpenGeneratedItems(autoOpen: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ auto_open_generated_items: autoOpen, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

// `undefined` fields are left untouched; pass `null` explicitly to clear a
// field back to the built-in default, same convention as
// updateCourseCustomization.
export async function setAppBranding(fields: {
  appName?: string | null;
  appIcon?: string | null;
  appIconImage?: string | null;
  appFont?: string | null;
  dashboardBackgroundImage?: string | null;
  dashboardBannerStyle?: "overlap" | "backdrop" | null;
}): Promise<void> {
  const values: Record<string, string | null> = {};
  if ("appName" in fields) values.app_name = fields.appName ?? null;
  if ("appIcon" in fields) values.app_icon = fields.appIcon ?? null;
  if ("appIconImage" in fields) values.app_icon_image = fields.appIconImage ?? null;
  if ("appFont" in fields) values.app_font = fields.appFont ?? null;
  if ("dashboardBackgroundImage" in fields) values.dashboard_background_image = fields.dashboardBackgroundImage ?? null;
  if ("dashboardBannerStyle" in fields) values.dashboard_banner_style = fields.dashboardBannerStyle ?? null;
  await db
    .update(app_settings)
    .set({ ...values, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

// --- Google Calendar ---
// "Bring your own" OAuth client, same convention as the AI provider keys —
// google_client_id/secret are the user's own Google Cloud project's
// credentials (see lib/googleCalendar.ts for the OAuth flow and the Calendar
// API calls themselves); never returned to the client, only presence flags
// (see AppSettings above), matching how the AI keys are handled.

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

export async function getGoogleClientCredentials(): Promise<GoogleClientCredentials | null> {
  const row = await getSettingsRow();
  if (!row?.google_client_id || !row?.google_client_secret) return null;
  return { clientId: row.google_client_id, clientSecret: row.google_client_secret };
}

export async function setGoogleClientCredentials(
  clientId: string,
  clientSecret: string
): Promise<void> {
  await db
    .update(app_settings)
    .set({
      google_client_id: clientId.trim() || null,
      google_client_secret: clientSecret.trim() || null,
      updated_at: nowUtc(),
    })
    .where(eq(app_settings.id, 1));
}

export interface GoogleTokens {
  accessToken: string | null;
  refreshToken: string | null;
  // Unix ms timestamp as a string — see schema.pg.ts's google_token_expiry.
  expiry: string | null;
}

export async function getGoogleTokens(): Promise<GoogleTokens | null> {
  const row = await getSettingsRow();
  if (!row?.google_refresh_token) return null;
  return {
    accessToken: row.google_access_token,
    refreshToken: row.google_refresh_token,
    expiry: row.google_token_expiry,
  };
}

// Merges rather than replaces: googleapis' OAuth2Client re-emits only the
// fields that actually changed on a token refresh (typically just a new
// access_token + expiry_date, keeping the same refresh_token since Google
// doesn't reissue one on every refresh) — see lib/googleCalendar.ts's
// "tokens" event listener.
export async function setGoogleTokens(tokens: Partial<GoogleTokens>): Promise<void> {
  const updates: Record<string, string | null> = {};
  if (tokens.accessToken !== undefined) updates.google_access_token = tokens.accessToken;
  if (tokens.refreshToken !== undefined) updates.google_refresh_token = tokens.refreshToken;
  if (tokens.expiry !== undefined) updates.google_token_expiry = tokens.expiry;
  await db
    .update(app_settings)
    .set({ ...updates, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await db
    .update(app_settings)
    .set({
      google_access_token: null,
      google_refresh_token: null,
      google_token_expiry: null,
      updated_at: nowUtc(),
    })
    .where(eq(app_settings.id, 1));
}

// --- Calendar feeds ---
// Read-only external ICS subscriptions (a university student portal's
// timetable, an LMS's assignment-due-dates feed, ...) — see
// lib/calendarFeeds.ts for the fetch/parse/merge side; this is just CRUD on
// the feed list itself, same shape as the folders/documents functions above.

export interface CalendarFeed {
  id: number;
  label: string;
  url: string;
  // Independently toggleable — a feed can back the Assignments widget's
  // checklist (show_in_widget) without also appearing on the /calendar
  // month grid (show_on_calendar), or vice versa. Both default true.
  show_on_calendar: boolean;
  show_in_widget: boolean;
  created_at: string;
}

export async function listCalendarFeeds(): Promise<CalendarFeed[]> {
  return db.select().from(calendar_feeds).orderBy(asc(calendar_feeds.id));
}

export async function addCalendarFeed(label: string, url: string): Promise<CalendarFeed> {
  const [feed] = await db
    .insert(calendar_feeds)
    .values({ label, url, created_at: nowUtc() })
    .returning();
  return feed;
}

export async function updateCalendarFeedVisibility(
  id: number,
  fields: { show_on_calendar?: boolean; show_in_widget?: boolean }
): Promise<void> {
  await db.update(calendar_feeds).set(fields).where(eq(calendar_feeds.id, id));
}

export async function deleteCalendarFeed(id: number): Promise<void> {
  await db.delete(calendar_feeds).where(eq(calendar_feeds.id, id));
}

// Checked-off state for the Assignments widget's checklist — keyed by the
// feed event's own id (see calendarFeeds.ts), since feed events aren't rows
// of their own; they're re-parsed from the feed URL on every read.
export async function listCompletedAssignmentIds(): Promise<string[]> {
  const rows = await db.select().from(completed_assignments);
  return rows.map((r) => r.event_id);
}

export async function setAssignmentCompleted(eventId: string, completed: boolean): Promise<void> {
  if (completed) {
    await db
      .insert(completed_assignments)
      .values({ event_id: eventId, completed_at: nowUtc() })
      .onConflictDoNothing();
  } else {
    await db.delete(completed_assignments).where(eq(completed_assignments.event_id, eventId));
  }
}

// --- Recent activity dashboard widget ---
// "Last opened" tracking for notes/documents/generated items — see the
// recent_views schema comment for why this is one upserted row per item
// rather than an append-only visit log.

export type RecentViewType = "note" | "document" | "item";

export interface RecentView {
  type: RecentViewType;
  id: number;
  title: string;
  courseId: number;
  courseName: string;
  mode?: GenerationMode; // only set for type === "item"
  viewedAt: string;
}

export async function clearRecentViews(): Promise<void> {
  await db.delete(recent_views);
}

export async function recordRecentView(itemType: RecentViewType, itemId: number): Promise<void> {
  const viewed_at = nowUtc();
  await db
    .insert(recent_views)
    .values({ item_type: itemType, item_id: itemId, viewed_at })
    .onConflictDoUpdate({
      target: [recent_views.item_type, recent_views.item_id],
      set: { viewed_at },
    });
}

export async function listRecentViews(limit = 8): Promise<RecentView[]> {
  // Overfetch: some rows may point at an item that's since been deleted —
  // those are dropped below rather than backfilled, so asking for a few
  // extra keeps the widget from coming up short of `limit` for no reason
  // visible to the viewer.
  const rows = await db
    .select()
    .from(recent_views)
    .orderBy(desc(recent_views.viewed_at))
    .limit(limit * 3);
  if (rows.length === 0) return [];

  const noteIds = rows.filter((r) => r.item_type === "note").map((r) => r.item_id);
  const docIds = rows.filter((r) => r.item_type === "document").map((r) => r.item_id);
  const itemIds = rows.filter((r) => r.item_type === "item").map((r) => r.item_id);

  const [noteRows, docRows, itemRows] = await Promise.all([
    noteIds.length
      ? db
          .select({ id: notes.id, title: notes.title, course_id: notes.course_id, course_name: courses.name })
          .from(notes)
          .leftJoin(courses, eq(notes.course_id, courses.id))
          .where(inArray(notes.id, noteIds))
      : Promise.resolve([]),
    docIds.length
      ? db
          .select({ id: documents.id, title: documents.filename, course_id: documents.course_id, course_name: courses.name })
          .from(documents)
          .leftJoin(courses, eq(documents.course_id, courses.id))
          .where(inArray(documents.id, docIds))
      : Promise.resolve([]),
    itemIds.length
      ? db
          .select({
            id: generated_items.id,
            title: generated_items.title,
            course_id: generated_items.course_id,
            course_name: courses.name,
            mode: generated_items.mode,
          })
          .from(generated_items)
          .leftJoin(courses, eq(generated_items.course_id, courses.id))
          .where(inArray(generated_items.id, itemIds))
      : Promise.resolve([]),
  ]);

  const noteMap = new Map(noteRows.map((r) => [r.id, r]));
  const docMap = new Map(docRows.map((r) => [r.id, r]));
  const itemMap = new Map(itemRows.map((r) => [r.id, r]));

  const result: RecentView[] = [];
  for (const row of rows) {
    if (result.length >= limit) break;
    if (row.item_type === "note") {
      const n = noteMap.get(row.item_id);
      if (n && n.course_id !== null) {
        result.push({ type: "note", id: n.id, title: n.title, courseId: n.course_id, courseName: n.course_name ?? "", viewedAt: row.viewed_at });
      }
    } else if (row.item_type === "document") {
      const d = docMap.get(row.item_id);
      if (d) {
        result.push({ type: "document", id: d.id, title: d.title, courseId: d.course_id, courseName: d.course_name ?? "", viewedAt: row.viewed_at });
      }
    } else if (row.item_type === "item") {
      const i = itemMap.get(row.item_id);
      if (i) {
        result.push({
          type: "item",
          id: i.id,
          title: i.title,
          courseId: i.course_id,
          courseName: i.course_name ?? "",
          mode: i.mode as GenerationMode,
          viewedAt: row.viewed_at,
        });
      }
    }
  }
  return result;
}

// --- Reusable icon/cover image library ---
// Every image ever cropped and uploaded via CustomizeCourseDialog (or any
// future per-thing image customization — see the schema.sql comment),
// browsable so picking a badge/banner doesn't always mean uploading fresh
// from disk.

export type UploadedImageKind = "icon" | "cover" | "background";

export interface UploadedImage {
  id: number;
  kind: UploadedImageKind;
  dataUrl: string;
  createdAt: string;
}

export async function listUploadedImages(kind: UploadedImageKind, limit = 40): Promise<UploadedImage[]> {
  const rows = await db
    .select()
    .from(uploaded_images)
    .where(eq(uploaded_images.kind, kind))
    .orderBy(desc(uploaded_images.created_at), desc(uploaded_images.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind as UploadedImageKind, dataUrl: r.data_url, createdAt: r.created_at }));
}

export async function recordUploadedImage(kind: UploadedImageKind, dataUrl: string): Promise<UploadedImage> {
  const created_at = nowUtc();
  const [row] = await db.insert(uploaded_images).values({ kind, data_url: dataUrl, created_at }).returning();
  return { id: row.id, kind, dataUrl, createdAt: created_at };
}

export async function deleteUploadedImage(id: number): Promise<void> {
  await db.delete(uploaded_images).where(eq(uploaded_images.id, id));
}

// --- The Vault: personal Obsidian-style notes ---
// User-authored markdown notes — deliberately separate from a course's
// AI-generated "notes" GenerationMode (a per-course study-notes document;
// see NotesContent above). Organized into courses/folders exactly like
// documents/generated items (course_id/folder_id/position; see
// listNotesForCourse, moveNote, reorderNotes below), but linking still
// crosses course boundaries — a note can [[link]] to a note, document, or
// generated item in any course via lib/noteLinks.ts's [[note:ID]] /
// [[doc:ID#snippet]] / [[item:ID#snippet]] syntax. Backlinks are computed
// at read time (see getNoteBacklinks) by scanning every note's markdown
// rather than kept in a denormalized links table — cheap at personal-vault
// scale, and never goes stale on an edit.

export interface Note {
  id: number;
  course_id: number;
  folder_id: number;
  position: number;
  title: string;
  markdown: string;
  icon: string | null;
  created_at: string;
  updated_at: string;
}

export async function getNote(id: number): Promise<Note | undefined> {
  const [note] = await db.select().from(notes).where(eq(notes.id, id));
  return note as Note | undefined;
}

// Same shape/ordering as listGeneratedItemsForCourse — notes render inside
// a course's folder tree the same way generated items and documents do.
export async function listNotesForCourse(courseId: number): Promise<Note[]> {
  return (await db
    .select()
    .from(notes)
    .where(eq(notes.course_id, courseId))
    .orderBy(asc(notes.position), desc(notes.created_at))) as Note[];
}

async function assertTitleAvailable(title: string, excludeId?: number): Promise<void> {
  const existing = await db.select().from(notes);
  const collision = existing.find(
    (n) => n.id !== excludeId && n.title.toLowerCase() === title.toLowerCase()
  );
  if (collision) throw new Error(`A note titled "${title}" already exists`);
}

// Same pattern as nextDocumentPosition — a newly created (or moved) note
// lands at the end of its destination folder.
async function nextNotePosition(folderId: number): Promise<number> {
  const [{ next }] = await db
    .select({ next: sql<number>`COALESCE(MAX(${notes.position}), -1) + 1` })
    .from(notes)
    .where(eq(notes.folder_id, folderId));
  return next;
}

export async function createNote(title: string, courseId: number, folderId?: number): Promise<Note> {
  await assertTitleAvailable(title);
  const resolvedFolderId = folderId ?? (await getMasterFolder(courseId)).id;
  const now = nowUtc();
  const [note] = await db
    .insert(notes)
    .values({
      title,
      markdown: "",
      course_id: courseId,
      folder_id: resolvedFolderId,
      position: await nextNotePosition(resolvedFolderId),
      created_at: now,
      updated_at: now,
    })
    .returning();
  return note as Note;
}

export async function renameNote(id: number, title: string): Promise<void> {
  await assertTitleAvailable(title, id);
  await db.update(notes).set({ title, updated_at: nowUtc() }).where(eq(notes.id, id));
}

export async function updateNoteMarkdown(id: number, markdown: string): Promise<void> {
  await db.update(notes).set({ markdown, updated_at: nowUtc() }).where(eq(notes.id, id));
}

export async function updateNoteIcon(id: number, icon: string | null): Promise<void> {
  await db.update(notes).set({ icon, updated_at: nowUtc() }).where(eq(notes.id, id));
}

// Lands at the end of the destination folder — same as moveDocument.
export async function moveNote(id: number, folderId: number): Promise<void> {
  await db
    .update(notes)
    .set({ folder_id: folderId, position: await nextNotePosition(folderId) })
    .where(eq(notes.id, id));
}

// Same pattern as reorderDocuments — scoped to one folder at a time.
export async function reorderNotes(folderId: number, orderedIds: number[]): Promise<void> {
  await runTransaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(notes)
        .set({ position: index })
        .where(and(eq(notes.id, id), eq(notes.folder_id, folderId)));
    }
  });
}

export async function deleteNote(id: number): Promise<void> {
  await db.delete(notes).where(eq(notes.id, id));
}

export interface NoteBacklink {
  noteId: number;
  noteTitle: string;
  courseId: number;
  context: string;
}

// The containing line of a [[note:id]] match, trimmed and capped — same
// "enough to recognize, not the whole note" idea as a search snippet.
const MAX_BACKLINK_CONTEXT = 160;

function backlinkContext(markdown: string, matchStart: number): string {
  const lineStart = markdown.lastIndexOf("\n", matchStart) + 1;
  const lineEndIdx = markdown.indexOf("\n", matchStart);
  const lineEnd = lineEndIdx === -1 ? markdown.length : lineEndIdx;
  const line = markdown.slice(lineStart, lineEnd).trim();
  return line.length > MAX_BACKLINK_CONTEXT ? `${line.slice(0, MAX_BACKLINK_CONTEXT)}…` : line;
}

export async function getNoteBacklinks(id: number): Promise<NoteBacklink[]> {
  const all = await db.select().from(notes).where(sql`${notes.id} != ${id}`);
  const backlinks: NoteBacklink[] = [];
  for (const other of all) {
    for (const link of parseNoteLinks(other.markdown)) {
      if (link.type === "note" && link.id === id) {
        backlinks.push({
          noteId: other.id,
          noteTitle: other.title,
          courseId: other.course_id!,
          context: backlinkContext(other.markdown, link.start),
        });
      }
    }
  }
  return backlinks;
}

export interface LinkTargets {
  notes: { id: number; title: string; courseId: number; courseName: string }[];
  documents: { id: number; filename: string; courseId: number; courseName: string }[];
  items: { id: number; title: string; courseId: number; courseName: string; mode: GenerationMode }[];
}

// Powers the Vault editor's "[[" note completion and its "Insert link"
// dialog for documents/generated items — one small full listing rather than
// a search-as-you-type endpoint, since a personal vault/course library is
// small enough to filter client-side (matches how Combobox is used
// elsewhere in this app).
export async function listLinkTargets(): Promise<LinkTargets> {
  const [noteRows, documentRows, itemRows] = await Promise.all([
    db
      .select({
        id: notes.id,
        title: notes.title,
        courseId: notes.course_id,
        courseName: courses.name,
      })
      .from(notes)
      .innerJoin(courses, eq(courses.id, notes.course_id))
      .orderBy(asc(notes.title)),
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        courseId: documents.course_id,
        courseName: courses.name,
      })
      .from(documents)
      .innerJoin(courses, eq(courses.id, documents.course_id)),
    db
      .select({
        id: generated_items.id,
        title: generated_items.title,
        courseId: generated_items.course_id,
        courseName: courses.name,
        mode: generated_items.mode,
      })
      .from(generated_items)
      .innerJoin(courses, eq(courses.id, generated_items.course_id)),
  ]);
  // The inner join guarantees courseId is non-null for every row — just
  // not something Drizzle's type inference can see through.
  return { notes: noteRows as LinkTargets["notes"], documents: documentRows, items: itemRows };
}

// The same line-split granularity as documentCandidates below — reused by
// the Vault editor's "Insert link" dialog to let a note link to a specific
// sentence/line within a document, not just the document as a whole.
export async function getDocumentLines(documentId: number): Promise<string[]> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc?.extracted_text) return [];
  return documentCandidates(omitEmbeddedImages(doc.extracted_text), "").map((c) => c.text);
}

// --- Home page widgets ---
// Which dashboard widgets show on "/", and their free-form position/size on
// a 4-column grid — like Android home-screen widgets: drag anywhere, resize
// independently. See lib/dashboardGrid.ts for the grid constants and the
// col/row/span → CSS translation, shared between the live dashboard
// (page.tsx) and the editing UI (DashboardCustomizeDialog.tsx).

export const HOME_WIDGET_IDS = ["streak", "due", "heatmap", "calendar", "assignments", "recent"] as const;
export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number];

// Two independent widget grids on the home page: "top" above the courses
// list (the original single dashboard), "bottom" below it. Same widget
// catalog in both — a widget only ever lives in one zone at a time, and
// dragging it into the other grid in the customize dialog reassigns this.
export const HOME_WIDGET_ZONES = ["top", "bottom"] as const;
export type HomeWidgetZone = (typeof HOME_WIDGET_ZONES)[number];

export interface HomeWidgetConfig {
  id: HomeWidgetId;
  enabled: boolean;
  zone: HomeWidgetZone;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  // A user-chosen display name overriding the widget's default title — e.g.
  // renaming "Assignments" to "Reading list" once it's just tracking
  // whatever feed(s) you've pointed it at. undefined/omitted falls back to
  // that widget's built-in default label (see WIDGET_DEFAULT_LABELS).
  label?: string;
}

// A sensible starting layout: streak/due as compact tiles side by side,
// heatmap and the agenda list each given a full-width row below — all in
// the top zone; the bottom zone starts empty.
const DEFAULT_HOME_WIDGETS: HomeWidgetConfig[] = [
  { id: "streak", enabled: true, zone: "top", col: 0, row: 0, colSpan: 3, rowSpan: 1 },
  { id: "due", enabled: true, zone: "top", col: 3, row: 0, colSpan: 3, rowSpan: 1 },
  { id: "heatmap", enabled: true, zone: "top", col: 0, row: 1, colSpan: 6, rowSpan: 1 },
  { id: "calendar", enabled: true, zone: "top", col: 0, row: 2, colSpan: 6, rowSpan: 1 },
  { id: "assignments", enabled: true, zone: "top", col: 0, row: 3, colSpan: 6, rowSpan: 1 },
  { id: "recent", enabled: true, zone: "top", col: 0, row: 4, colSpan: 6, rowSpan: 2 },
];

function defaultFor(id: HomeWidgetId): HomeWidgetConfig {
  return DEFAULT_HOME_WIDGETS.find((w) => w.id === id)!;
}

// Tolerant of a stored config from before a widget existed (appends it,
// enabled, in its default slot) or one naming a widget that's since been
// removed (dropped) — so adding/removing a widget in code never produces a
// broken or stuck settings value for someone who already customized their
// layout. Also tolerant of a config saved before col/row/span existed, or
// with corrupted position data (falls back to that widget's default slot),
// and of one saved before zones existed (defaults to "top", preserving
// exactly where it already was for anyone upgrading).
function parseHomeWidgets(raw: string | null): HomeWidgetConfig[] {
  if (!raw) return DEFAULT_HOME_WIDGETS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_HOME_WIDGETS;
    const isFiniteNonNegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    const known = new Map(
      parsed
        .filter(
          (
            w
          ): w is {
            id: HomeWidgetId;
            enabled: boolean;
            zone?: unknown;
            col?: unknown;
            row?: unknown;
            colSpan?: unknown;
            rowSpan?: unknown;
            label?: unknown;
          } => w && typeof w.id === "string" && HOME_WIDGET_IDS.includes(w.id as HomeWidgetId) && typeof w.enabled === "boolean"
        )
        .map((w) => {
          const hasValidLayout =
            isFiniteNonNegative(w.col) &&
            isFiniteNonNegative(w.row) &&
            isFiniteNonNegative(w.colSpan) &&
            isFiniteNonNegative(w.rowSpan);
          const layout = hasValidLayout
            ? (w as { col: number; row: number; colSpan: number; rowSpan: number })
            : defaultFor(w.id);
          const zone: HomeWidgetZone = w.zone === "bottom" ? "bottom" : "top";
          const label = typeof w.label === "string" && w.label.trim() ? w.label.trim() : undefined;
          return [
            w.id,
            {
              id: w.id,
              enabled: w.enabled,
              zone,
              col: layout.col,
              row: layout.row,
              colSpan: layout.colSpan,
              rowSpan: layout.rowSpan,
              label,
            } satisfies HomeWidgetConfig,
          ];
        })
    );
    const missing = HOME_WIDGET_IDS.filter((id) => !known.has(id)).map((id) => defaultFor(id));
    return [...known.values(), ...missing];
  } catch {
    return DEFAULT_HOME_WIDGETS;
  }
}

export async function setHomeWidgets(widgets: HomeWidgetConfig[]): Promise<void> {
  await db
    .update(app_settings)
    .set({ home_widgets: JSON.stringify(widgets), updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

// --- Courses ---

// Every course is created with its permanent default folder ("Unsorted") in
// the same transaction, so a course can never exist without one. New courses
// are prepended (position below every existing course) rather than appended,
// so a course you just created still shows up first — the "newest first"
// behavior this app had before manual ordering existed.
export async function createCourse(name: string): Promise<Course> {
  return runTransaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`COALESCE(MIN(${courses.position}), 1) - 1` })
      .from(courses);
    const [course] = await tx
      .insert(courses)
      .values({ name, position: next, created_at: nowUtc() })
      .returning();
    await tx.insert(folders).values({
      course_id: course.id,
      name: "Unsorted",
      is_master: true,
      created_at: nowUtc(),
    });
    return course;
  });
}

export async function getCourse(id: number): Promise<Course | undefined> {
  const rows = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  return rows[0];
}

export async function listCourses(): Promise<Course[]> {
  return db.select().from(courses).orderBy(asc(courses.position), desc(courses.created_at));
}

export async function renameCourse(id: number, name: string): Promise<void> {
  await db.update(courses).set({ name }).where(eq(courses.id, id));
}

// `undefined` fields are left untouched; pass `null` explicitly to clear a
// field (e.g. removing a cover image).
export async function updateCourseCustomization(
  id: number,
  fields: {
    icon?: string | null;
    color?: string | null;
    cover_image?: string | null;
    icon_image?: string | null;
    page_background_image?: string | null;
    show_cover_on_card?: boolean;
    show_icon_frame?: boolean;
  }
): Promise<void> {
  await db.update(courses).set(fields).where(eq(courses.id, id));
}

// Applies a new drag-and-drop order in one transaction, same pattern as
// reorderFolders below.
export async function reorderCourses(orderedIds: number[]): Promise<void> {
  await runTransaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.update(courses).set({ position: index }).where(eq(courses.id, id));
    }
  });
}

export async function deleteCourse(id: number): Promise<void> {
  await db.delete(courses).where(eq(courses.id, id));
}

// --- Folders ---
// One tree per course: a folder holds both its documents and its generated
// items directly (see lib/generate.ts and lib/context.ts). Every course has
// exactly one permanent, undeletable default folder ("Unsorted").

export async function createFolder(
  courseId: number,
  name: string,
  parentFolderId?: number | null
): Promise<Folder> {
  if (parentFolderId != null) {
    const parent = await getFolder(parentFolderId);
    if (parent?.parent_folder_id != null) {
      throw new CannotNestSubfolderError();
    }
  }
  const [{ next }] = await db
    .select({ next: sql<number>`COALESCE(MAX(${folders.position}), -1) + 1` })
    .from(folders)
    .where(eq(folders.course_id, courseId));
  const [folder] = await db
    .insert(folders)
    .values({
      course_id: courseId,
      name,
      parent_folder_id: parentFolderId ?? null,
      position: next,
      created_at: nowUtc(),
    })
    .returning();
  return folder;
}

export async function getFolder(id: number): Promise<Folder | undefined> {
  const rows = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  return rows[0];
}

export async function getMasterFolder(courseId: number): Promise<Folder> {
  const rows = await db
    .select()
    .from(folders)
    .where(and(eq(folders.course_id, courseId), eq(folders.is_master, true)))
    .limit(1);
  if (!rows[0]) {
    // Should be unreachable post-migration (every course gets one on
    // creation, and db/sqlite.ts backfills any that predate this).
    throw new Error(`Course ${courseId} has no default folder`);
  }
  return rows[0];
}

export async function renameFolder(id: number, name: string): Promise<void> {
  await db.update(folders).set({ name }).where(eq(folders.id, id));
}

// Same `undefined`-skip/`null`-clears convention as updateCourseCustomization.
export async function updateFolderCustomization(
  id: number,
  fields: { icon?: string | null; color?: string | null }
): Promise<void> {
  await db.update(folders).set(fields).where(eq(folders.id, id));
}

// Drag-and-drop "nest under this folder" — used by dropping one folder
// onto another's header (see FolderCard in courses/[courseId]/page.tsx),
// distinct from onReorder (dropping into the gap between cards). Enforces
// the same one-level-nesting rule as createFolder's parentFolderId check,
// in both directions: the target can't itself be a subfolder, and the
// folder being moved can't already have subfolders of its own.
// parentFolderId: null un-nests (moves a subfolder back to top level) — no
// validation needed there, any folder can always become top-level again.
// A non-null value nests, subject to the one-level rule below.
export async function nestFolder(id: number, parentFolderId: number | null): Promise<void> {
  const folder = await getFolder(id);
  if (!folder || folder.is_master) return;

  if (parentFolderId == null) {
    await db.update(folders).set({ parent_folder_id: null }).where(eq(folders.id, id));
    return;
  }
  if (id === parentFolderId) return;
  const parent = await getFolder(parentFolderId);
  if (!parent) return;
  if (parent.parent_folder_id != null) {
    throw new CannotNestSubfolderError();
  }
  const ownSubfolders = await db
    .select()
    .from(folders)
    .where(eq(folders.parent_folder_id, id));
  if (ownSubfolders.length > 0) {
    throw new CannotNestSubfolderError();
  }
  await db.update(folders).set({ parent_folder_id: parentFolderId }).where(eq(folders.id, id));
}

// Applies a new drag-and-drop order in one transaction. Any folder id not
// present in orderedIds (there shouldn't be one, but defensively) keeps its
// existing position rather than erroring.
export async function reorderFolders(courseId: number, orderedIds: number[]): Promise<void> {
  await runTransaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(folders)
        .set({ position: index })
        .where(and(eq(folders.id, id), eq(folders.course_id, courseId)));
    }
  });
}

export async function listFoldersForCourse(courseId: number): Promise<Folder[]> {
  return db
    .select()
    .from(folders)
    .where(eq(folders.course_id, courseId))
    .orderBy(asc(folders.position), asc(folders.created_at));
}

// Deleting a folder never orphans anything: its documents and generated
// items are reassigned to the course's default folder first, so the
// "everything always belongs to a real folder" invariant holds even here.
// The default folder itself can't be deleted.
export async function deleteFolder(id: number): Promise<void> {
  const folder = await getFolder(id);
  if (!folder) return;
  if (folder.is_master) {
    throw new CannotDeleteMasterFolderError();
  }
  const root = await getMasterFolder(folder.course_id);

  // Deleting a parent folder takes its subfolders with it (one level of
  // nesting, so this is never recursive) — every one of them needs its own
  // documents/items reassigned first too, same as the parent, so nothing
  // winds up with a NULL folder_id.
  const subfolders = await db
    .select()
    .from(folders)
    .where(eq(folders.parent_folder_id, id));
  const targetIds = [id, ...subfolders.map((f) => f.id)];

  await runTransaction(async (tx) => {
    for (const targetId of targetIds) {
      await tx
        .update(documents)
        .set({ folder_id: root.id })
        .where(eq(documents.folder_id, targetId));
      await tx
        .update(generated_items)
        .set({ folder_id: root.id })
        .where(eq(generated_items.folder_id, targetId));
    }
    for (const sub of subfolders) {
      await tx.delete(folders).where(eq(folders.id, sub.id));
    }
    await tx.delete(folders).where(eq(folders.id, id));
  });
}

// --- Documents ---

// Documents display oldest-first within a folder (see listDocumentsForCourse),
// so a newly uploaded/pasted/moved-in document appends to the end — same
// convention as folders' own position (see createFolder).
async function nextDocumentPosition(folderId: number): Promise<number> {
  const [{ next }] = await db
    .select({ next: sql<number>`COALESCE(MAX(${documents.position}), -1) + 1` })
    .from(documents)
    .where(eq(documents.folder_id, folderId));
  return next;
}

export async function createDocument(params: {
  courseId: number;
  folderId: number;
  filename: string;
  filePath: string;
  // null for pasted-text documents, which have no underlying file — see
  // POST .../documents/paste/route.ts.
  fileBase64: string | null;
}): Promise<DocumentRow> {
  const [doc] = await db
    .insert(documents)
    .values({
      course_id: params.courseId,
      folder_id: params.folderId,
      position: await nextDocumentPosition(params.folderId),
      filename: params.filename,
      file_path: params.filePath,
      file_base64: params.fileBase64,
      status: "pending",
      created_at: nowUtc(),
    })
    .returning();
  return doc as DocumentRow;
}

export async function getDocument(id: number): Promise<DocumentRow | undefined> {
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return rows[0] as DocumentRow | undefined;
}

// For the document-viewing route only — file_base64 can be several MB, so
// it's fetched narrowly on demand rather than as part of any list query.
export async function getDocumentFile(
  id: number
): Promise<{ filename: string; file_path: string; file_base64: string | null } | undefined> {
  const rows = await db
    .select({
      filename: documents.filename,
      file_path: documents.file_path,
      file_base64: documents.file_base64,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return rows[0];
}

// Explicitly excludes file_base64 — this feeds the course page's document
// list, sent on every course-page load, and a several-MB base64 blob per
// document in that response would be a serious payload regression.
export async function listDocumentsForCourse(courseId: number): Promise<DocumentRow[]> {
  return db
    .select({
      id: documents.id,
      course_id: documents.course_id,
      folder_id: documents.folder_id,
      position: documents.position,
      filename: documents.filename,
      file_path: documents.file_path,
      extracted_text: documents.extracted_text,
      page_count: documents.page_count,
      char_count: documents.char_count,
      status: documents.status,
      error_message: documents.error_message,
      created_at: documents.created_at,
    })
    .from(documents)
    .where(eq(documents.course_id, courseId))
    .orderBy(asc(documents.position), asc(documents.created_at)) as Promise<DocumentRow[]>;
}

export async function markDocumentExtracted(params: {
  id: number;
  extractedText: string;
  pageCount: number;
  charCount: number;
}): Promise<void> {
  await db
    .update(documents)
    .set({
      extracted_text: params.extractedText,
      page_count: params.pageCount,
      char_count: params.charCount,
      status: "extracted",
      error_message: null,
    })
    .where(eq(documents.id, params.id));
}

export async function markDocumentFailed(id: number, errorMessage: string): Promise<void> {
  await db
    .update(documents)
    .set({ status: "failed", error_message: errorMessage })
    .where(eq(documents.id, id));
}

export async function deleteDocument(id: number): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id));
}

export async function moveDocument(id: number, folderId: number): Promise<void> {
  // Lands at the end of the destination folder — same place a newly
  // uploaded document would, rather than keeping whatever position number
  // it happened to have in its old folder (meaningless there).
  await db
    .update(documents)
    .set({ folder_id: folderId, position: await nextDocumentPosition(folderId) })
    .where(eq(documents.id, id));
}

// Applies a new drag-and-drop order in one transaction, same pattern as
// reorderFolders — scoped to one folder at a time (documents display
// per-folder, see listDocumentsForCourse), so `folderId` guards against
// reordering documents that aren't actually there.
export async function reorderDocuments(folderId: number, orderedIds: number[]): Promise<void> {
  await runTransaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(documents)
        .set({ position: index })
        .where(and(eq(documents.id, id), eq(documents.folder_id, folderId)));
    }
  });
}

// --- Generated items ---
// courseId is required on every read/write here by construction — see lib/context.ts
// for the single function allowed to assemble cross-document text for a course.

// Generated items display newest-first within a folder (see
// listGeneratedItemsForCourse), so a newly generated/moved-in item prepends
// to the front — mirrors courses' own "prepend" position convention (see
// createCourse) rather than documents' "append" one.
async function nextGeneratedItemPosition(folderId: number): Promise<number> {
  const [{ next }] = await db
    .select({ next: sql<number>`COALESCE(MIN(${generated_items.position}), 1) - 1` })
    .from(generated_items)
    .where(eq(generated_items.folder_id, folderId));
  return next;
}

export async function createGeneratedItem(params: {
  courseId: number;
  folderId: number;
  sourceFolderId: number | null;
  mode: GenerationMode;
  title: string;
  contentJson: unknown;
  sourceDocumentIds: number[];
  model?: { provider: AiBackend; model: string };
}): Promise<GeneratedItem> {
  const now = nowUtc();
  const [item] = await db
    .insert(generated_items)
    .values({
      course_id: params.courseId,
      folder_id: params.folderId,
      position: await nextGeneratedItemPosition(params.folderId),
      source_folder_id: params.sourceFolderId,
      mode: params.mode,
      title: params.title,
      content_json: JSON.stringify(params.contentJson),
      source_document_ids: JSON.stringify(params.sourceDocumentIds),
      model_provider: params.model?.provider ?? null,
      model_name: params.model?.model ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return item as GeneratedItem;
}

// Documents within the item's actual generation scope (source_folder_id —
// the whole course if null/pooled, otherwise that one folder; NOT
// necessarily the folder the item is filed in, see schema.sql), extracted,
// and not already reflected in source_document_ids — i.e. what a
// "supplement" pass would add.
export async function getNewDocumentsForItem(item: GeneratedItem): Promise<DocumentRow[]> {
  const covered = new Set(JSON.parse(item.source_document_ids) as number[]);
  const docs =
    item.source_folder_id == null
      ? (await listDocumentsForCourse(item.course_id)).filter((d) => d.status === "extracted")
      : ((await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.course_id, item.course_id),
              eq(documents.folder_id, item.source_folder_id),
              eq(documents.status, "extracted")
            )
          )
          .orderBy(asc(documents.created_at))) as DocumentRow[]);
  return docs.filter((d) => !covered.has(d.id));
}

// Overwrites content_json/source_document_ids in place — same item id, so
// existing QuizAttempt/FlashcardReview rows (which reference entries by
// array index) stay valid as long as callers only ever append, never
// reorder. See lib/generate.ts's supplementGeneratedItem/mergeGeneratedContent.
export async function updateGeneratedItemContent(params: {
  id: number;
  contentJson: unknown;
  sourceDocumentIds: number[];
  // A supplement pass may run under a different provider than the item's
  // original generation (e.g. the user switched providers meanwhile) — the
  // badge should reflect whatever most recently added content, not the
  // original. Omitted (e.g. by grading/other callers that don't touch
  // content) leaves the existing model_provider/model_name untouched.
  model?: { provider: AiBackend; model: string };
}): Promise<GeneratedItem> {
  const [item] = await db
    .update(generated_items)
    .set({
      content_json: JSON.stringify(params.contentJson),
      source_document_ids: JSON.stringify(params.sourceDocumentIds),
      ...(params.model
        ? { model_provider: params.model.provider, model_name: params.model.model }
        : {}),
      updated_at: nowUtc(),
    })
    .where(eq(generated_items.id, params.id))
    .returning();
  return item as GeneratedItem;
}

export async function moveGeneratedItem(id: number, folderId: number): Promise<void> {
  // Lands at the front of the destination folder — same place a freshly
  // generated item would.
  await db
    .update(generated_items)
    .set({ folder_id: folderId, position: await nextGeneratedItemPosition(folderId) })
    .where(eq(generated_items.id, id));
}

// Applies a new drag-and-drop order in one transaction, same pattern as
// reorderDocuments/reorderFolders.
export async function reorderGeneratedItems(folderId: number, orderedIds: number[]): Promise<void> {
  await runTransaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(generated_items)
        .set({ position: index })
        .where(and(eq(generated_items.id, id), eq(generated_items.folder_id, folderId)));
    }
  });
}

// quiz_attempts/flashcard_reviews reference generated_items ON DELETE CASCADE,
// so their history is cleaned up automatically.
export async function deleteGeneratedItem(id: number): Promise<void> {
  await db.delete(generated_items).where(eq(generated_items.id, id));
}

export async function getGeneratedItem(id: number): Promise<GeneratedItem | undefined> {
  const rows = await db.select().from(generated_items).where(eq(generated_items.id, id)).limit(1);
  return rows[0] as GeneratedItem | undefined;
}

export async function listGeneratedItemsForCourse(courseId: number): Promise<GeneratedItem[]> {
  return (await db
    .select()
    .from(generated_items)
    .where(eq(generated_items.course_id, courseId))
    .orderBy(asc(generated_items.position), desc(generated_items.created_at))) as GeneratedItem[];
}

// --- Quiz attempts ---

export async function createQuizAttempt(generatedItemId: number): Promise<QuizAttempt> {
  const [attempt] = await db
    .insert(quiz_attempts)
    .values({ generated_item_id: generatedItemId, started_at: nowUtc() })
    .returning();
  return attempt;
}

export async function getQuizAttempt(id: number): Promise<QuizAttempt | undefined> {
  const rows = await db.select().from(quiz_attempts).where(eq(quiz_attempts.id, id)).limit(1);
  return rows[0];
}

export async function completeQuizAttempt(params: {
  id: number;
  score: number;
  answersJson: unknown;
}): Promise<void> {
  await db
    .update(quiz_attempts)
    .set({
      completed_at: nowUtc(),
      score: params.score,
      answers_json: JSON.stringify(params.answersJson),
    })
    .where(eq(quiz_attempts.id, params.id));
}

export async function listQuizAttemptsForItem(generatedItemId: number): Promise<QuizAttempt[]> {
  return db
    .select()
    .from(quiz_attempts)
    .where(eq(quiz_attempts.generated_item_id, generatedItemId))
    .orderBy(desc(quiz_attempts.started_at));
}

// --- Flashcard reviews ---

export async function logFlashcardReview(params: {
  generatedItemId: number;
  cardIndex: number;
  result: FlashcardResult;
}): Promise<void> {
  await db.insert(flashcard_reviews).values({
    generated_item_id: params.generatedItemId,
    card_index: params.cardIndex,
    last_result: params.result,
    reviewed_at: nowUtc(),
  });
}

export async function listFlashcardReviewsForItem(generatedItemId: number) {
  return db
    .select()
    .from(flashcard_reviews)
    .where(eq(flashcard_reviews.generated_item_id, generatedItemId))
    .orderBy(desc(flashcard_reviews.reviewed_at));
}

// --- Flashcard scheduling ---
// Current per-card state, distinct from the flashcard_reviews log above —
// see schema.sql. A card with no row here has never been reviewed and is
// due immediately.

export interface FlashcardScheduleRow {
  generated_item_id: number;
  card_index: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
  last_reviewed_at: string | null;
}

export async function getFlashcardSchedule(
  generatedItemId: number,
  cardIndex: number
): Promise<FlashcardScheduleRow | undefined> {
  const rows = await db
    .select()
    .from(flashcard_schedule)
    .where(
      and(
        eq(flashcard_schedule.generated_item_id, generatedItemId),
        eq(flashcard_schedule.card_index, cardIndex)
      )
    )
    .limit(1);
  return rows[0];
}

export async function getFlashcardScheduleForItem(
  generatedItemId: number
): Promise<FlashcardScheduleRow[]> {
  return db
    .select()
    .from(flashcard_schedule)
    .where(eq(flashcard_schedule.generated_item_id, generatedItemId));
}

export async function upsertFlashcardSchedule(params: {
  generatedItemId: number;
  cardIndex: number;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
}): Promise<void> {
  const last_reviewed_at = nowUtc();
  await db
    .insert(flashcard_schedule)
    .values({
      generated_item_id: params.generatedItemId,
      card_index: params.cardIndex,
      ease_factor: params.easeFactor,
      interval_days: params.intervalDays,
      repetitions: params.repetitions,
      due_at: params.dueAt,
      last_reviewed_at,
    })
    .onConflictDoUpdate({
      target: [flashcard_schedule.generated_item_id, flashcard_schedule.card_index],
      set: {
        ease_factor: params.easeFactor,
        interval_days: params.intervalDays,
        repetitions: params.repetitions,
        due_at: params.dueAt,
        last_reviewed_at,
      },
    });
}

// flashcard_schedule rows are keyed by positional card_index into the
// FlashcardsContent.cards array, not a stable per-card id. Removing a card
// via EditFlashcardsDialog shifts every later card's index down by one —
// without this, each of those cards would silently inherit whatever
// schedule state (due date, ease factor, streak) used to belong to a
// different card at that index. Rebuilds every row for the item in one
// pass (delete + reinsert) rather than shifting in place, since an
// in-place UPDATE walking indices downward could momentarily collide with
// the (generated_item_id, card_index) unique constraint.
export async function reconcileFlashcardScheduleAfterRemoval(
  generatedItemId: number,
  removedIndices: number[]
): Promise<void> {
  if (removedIndices.length === 0) return;
  const removed = [...new Set(removedIndices)].sort((a, b) => a - b);

  const rows = await db
    .select()
    .from(flashcard_schedule)
    .where(eq(flashcard_schedule.generated_item_id, generatedItemId));
  if (rows.length === 0) return;

  const remapped = rows
    .filter((r) => !removed.includes(r.card_index))
    .map((r) => ({
      ...r,
      card_index: r.card_index - removed.filter((i) => i < r.card_index).length,
    }));

  await runTransaction(async (tx) => {
    await tx
      .delete(flashcard_schedule)
      .where(eq(flashcard_schedule.generated_item_id, generatedItemId));
    if (remapped.length > 0) {
      await tx.insert(flashcard_schedule).values(remapped);
    }
  });
}

// --- Search ---
// Fuzzy, typo-tolerant search across both generated items (notes/quiz/
// flashcards) and uploaded documents' extracted text, via Fuse.js scoring
// in the application layer rather than a database full-text index — SQLite
// FTS5 and Postgres tsvector/pg_trgm are both dialect-specific, which would
// break the "identical behavior on both backends" the rest of this data
// layer is built around. Fine at this app's scale (a personal instance,
// dozens of items) to load all candidate text and score it in Node per
// search; a persistent index would only matter at a much larger scale.

export interface ItemSearchResult {
  kind: "item";
  itemId: number;
  itemTitle: string;
  courseId: number;
  courseName: string;
  mode: GenerationMode;
  snippets: string[];
}

export interface DocumentSearchResult {
  kind: "document";
  documentId: number;
  filename: string;
  courseId: number;
  courseName: string;
  snippets: string[];
}

export interface NoteSearchResult {
  kind: "note";
  noteId: number;
  noteTitle: string;
  courseId: number;
  courseName: string;
  snippets: string[];
}

export type SearchResult = ItemSearchResult | DocumentSearchResult | NoteSearchResult;

const MAX_SNIPPETS_PER_ITEM = 3;

// One fuzzy-search candidate per searchable unit, tagged with a key that
// groups matches back to their parent item/document afterward. Flashcard
// fronts and backs are separate candidates (unlike the old substring
// search) so a back-only match reports the text that actually matched,
// not always the front.
interface SearchCandidate {
  key: string;
  text: string;
}

function itemCandidates(
  mode: GenerationMode,
  contentJson: string,
  key: string
): SearchCandidate[] {
  const content = JSON.parse(contentJson);
  switch (mode) {
    case "quiz":
      return (content as QuizContent).questions.map((q) => ({ key, text: q.question }));
    case "flashcards":
      return (content as FlashcardsContent).cards.flatMap((c) => [
        { key, text: c.front },
        { key, text: c.back },
      ]);
    case "notes":
      return (content as NotesContent).markdown
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => ({ key, text: line }));
  }
}

function documentCandidates(extractedText: string, key: string): SearchCandidate[] {
  return extractedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ key, text: line }));
}

function noteCandidates(markdown: string, key: string): SearchCandidate[] {
  return stripNoteLinkSyntax(markdown)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ key, text: line }));
}

export async function searchAll(query: string, courseId?: number): Promise<SearchResult[]> {
  const itemsBase = db
    .select()
    .from(generated_items)
    .innerJoin(courses, eq(courses.id, generated_items.course_id));
  const documentsBase = db
    .select({
      id: documents.id,
      course_id: documents.course_id,
      filename: documents.filename,
      extracted_text: documents.extracted_text,
      course_name: courses.name,
    })
    .from(documents)
    .innerJoin(courses, eq(courses.id, documents.course_id));

  const notesBase = db
    .select({
      id: notes.id,
      course_id: notes.course_id,
      title: notes.title,
      markdown: notes.markdown,
      course_name: courses.name,
    })
    .from(notes)
    .innerJoin(courses, eq(courses.id, notes.course_id));

  const [itemRows, documentRows, noteRows] = await Promise.all([
    courseId ? itemsBase.where(eq(generated_items.course_id, courseId)) : itemsBase,
    courseId ? documentsBase.where(eq(documents.course_id, courseId)) : documentsBase,
    courseId ? notesBase.where(eq(notes.course_id, courseId)) : notesBase,
  ]);

  const candidates: SearchCandidate[] = [];
  const metaByKey = new Map<string, ItemSearchResult | DocumentSearchResult | NoteSearchResult>();

  for (const row of itemRows) {
    const item = row.generated_items;
    const key = `item:${item.id}`;
    candidates.push(...itemCandidates(item.mode, item.content_json, key));
    metaByKey.set(key, {
      kind: "item",
      itemId: item.id,
      itemTitle: item.title,
      courseId: item.course_id,
      courseName: row.courses.name,
      mode: item.mode,
      snippets: [],
    });
  }

  for (const doc of documentRows) {
    if (!doc.extracted_text) continue;
    const key = `doc:${doc.id}`;
    candidates.push(...documentCandidates(omitEmbeddedImages(doc.extracted_text), key));
    metaByKey.set(key, {
      kind: "document",
      documentId: doc.id,
      filename: doc.filename,
      courseId: doc.course_id,
      courseName: doc.course_name,
      snippets: [],
    });
  }

  for (const note of noteRows) {
    if (!note.markdown) continue;
    const key = `note:${note.id}`;
    candidates.push(...noteCandidates(note.markdown, key));
    metaByKey.set(key, {
      kind: "note",
      noteId: note.id,
      noteTitle: note.title,
      courseId: note.course_id!,
      courseName: note.course_name,
      snippets: [],
    });
  }

  if (candidates.length === 0) return [];

  const fuse = new Fuse(candidates, {
    keys: ["text"],
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  // Group matches (already sorted best-first by Fuse) back to their parent,
  // capping snippets per parent and tracking each parent's best score so
  // parents themselves can be sorted by relevance too.
  const snippetsByKey = new Map<string, string[]>();
  const bestScoreByKey = new Map<string, number>();
  for (const { item: candidate, score } of fuse.search(query)) {
    const list = snippetsByKey.get(candidate.key) ?? [];
    if (list.length < MAX_SNIPPETS_PER_ITEM && !list.includes(candidate.text)) {
      list.push(candidate.text);
      snippetsByKey.set(candidate.key, list);
    }
    const best = bestScoreByKey.get(candidate.key);
    if (best === undefined || (score ?? 1) < best) {
      bestScoreByKey.set(candidate.key, score ?? 1);
    }
  }

  return [...snippetsByKey.entries()]
    .sort(([a], [b]) => bestScoreByKey.get(a)! - bestScoreByKey.get(b)!)
    .map(([key, snippets]) => ({ ...metaByKey.get(key)!, snippets }));
}

// --- Study stats (home page dashboard) ---

// Every distinct UTC day ("YYYY-MM-DD") with at least one completed quiz
// attempt or flashcard review — the input to streak.ts's computeStreak.
// Extracted in JS (not a DB date() function) so the same code works
// whichever backend is active — every timestamp is already a plain
// "YYYY-MM-DD HH:MM:SS" string (see lib/time.ts).
export async function listStudyDates(): Promise<string[]> {
  const [quizRows, reviewRows] = await Promise.all([
    db
      .select({ completed_at: quiz_attempts.completed_at })
      .from(quiz_attempts)
      .where(isNotNull(quiz_attempts.completed_at)),
    db.select({ reviewed_at: flashcard_reviews.reviewed_at }).from(flashcard_reviews),
  ]);
  const dates = new Set<string>();
  for (const row of quizRows) {
    if (row.completed_at) dates.add(row.completed_at.slice(0, 10));
  }
  for (const row of reviewRows) {
    dates.add(row.reviewed_at.slice(0, 10));
  }
  return [...dates];
}

// Same underlying rows as listStudyDates, but keyed by date with a count
// instead of just presence — feeds the home page's activity heatmap, where
// a day with one review and a day with twenty should look different.
export async function listStudyActivityCounts(): Promise<Record<string, number>> {
  const [quizRows, reviewRows] = await Promise.all([
    db
      .select({ completed_at: quiz_attempts.completed_at })
      .from(quiz_attempts)
      .where(isNotNull(quiz_attempts.completed_at)),
    db.select({ reviewed_at: flashcard_reviews.reviewed_at }).from(flashcard_reviews),
  ]);
  const counts: Record<string, number> = {};
  for (const row of quizRows) {
    if (!row.completed_at) continue;
    const day = row.completed_at.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  for (const row of reviewRows) {
    const day = row.reviewed_at.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

export interface DueFlashcardItem {
  itemId: number;
  title: string;
  courseId: number;
  courseName: string;
  dueCount: number;
}

// One item per flashcards-mode generated item with at least one card due,
// across every course. Two queries (items, all schedule rows) combined in
// JS rather than one aggregate SQL query — card counts live inside
// content_json, not a column, so per-item due-ness has to go through
// computeDueCardIndices the same way the single-item route does.
export async function listDueFlashcardItems(): Promise<DueFlashcardItem[]> {
  const [rows, allSchedule] = await Promise.all([
    db
      .select()
      .from(generated_items)
      .innerJoin(courses, eq(courses.id, generated_items.course_id))
      .where(eq(generated_items.mode, "flashcards")),
    db.select().from(flashcard_schedule),
  ]);

  const scheduleByItem = new Map<number, FlashcardScheduleRow[]>();
  for (const row of allSchedule) {
    const list = scheduleByItem.get(row.generated_item_id) ?? [];
    list.push(row);
    scheduleByItem.set(row.generated_item_id, list);
  }

  const due: DueFlashcardItem[] = [];
  for (const row of rows) {
    const item = row.generated_items;
    const cardCount = (JSON.parse(item.content_json) as FlashcardsContent).cards.length;
    const dueCount = computeDueCardIndices(scheduleByItem.get(item.id) ?? [], cardCount).length;
    if (dueCount > 0) {
      due.push({
        itemId: item.id,
        title: item.title,
        courseId: item.course_id,
        courseName: row.courses.name,
        dueCount,
      });
    }
  }
  return due;
}

export interface GenerationNotification {
  itemId: number;
  title: string;
  mode: GenerationMode;
  courseId: number;
  courseName: string;
  createdAt: string;
}

// Only ever written when app_settings.auto_open_generated_items is off — see
// the generate route, which is this function's one caller.
export async function createGenerationNotification(itemId: number): Promise<void> {
  await db
    .insert(generation_notifications)
    .values({ generated_item_id: itemId, created_at: nowUtc() })
    .onConflictDoNothing();
}

// Idempotent — called both when the user explicitly dismisses one and when
// they open the item it's for (see the items/[itemId] page's own effect), so
// calling it again after it's already gone is a normal no-op, not an error.
// Deleting the item itself clears its notification too, via this table's own
// ON DELETE CASCADE — no separate call needed from deleteGeneratedItem.
export async function dismissGenerationNotification(itemId: number): Promise<void> {
  await db
    .delete(generation_notifications)
    .where(eq(generation_notifications.generated_item_id, itemId));
}

// One entry per still-pending notification, across every course — same
// shape/join pattern as listDueFlashcardItems above, and combined with it on
// the home page so a course's badge dot lights up for either reason.
export async function listGenerationNotifications(): Promise<GenerationNotification[]> {
  const rows = await db
    .select()
    .from(generation_notifications)
    .innerJoin(generated_items, eq(generated_items.id, generation_notifications.generated_item_id))
    .innerJoin(courses, eq(courses.id, generated_items.course_id))
    .orderBy(desc(generation_notifications.created_at));

  return rows.map((row) => ({
    itemId: row.generated_items.id,
    title: row.generated_items.title,
    mode: row.generated_items.mode as GenerationMode,
    courseId: row.generated_items.course_id,
    courseName: row.courses.name,
    createdAt: row.generation_notifications.created_at,
  }));
}
