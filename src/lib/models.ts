import fs from "node:fs/promises";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import Fuse from "fuse.js";
import {
  db,
  app_settings,
  canvases,
  calendar_feeds,
  completed_assignments,
  courses,
  documents,
  chat_conversations,
  chat_messages,
  flashcard_reviews,
  folders,
  generated_items,
  generation_notifications,
  notes,
  quiz_attempts,
  quiz_generation_presets,
  recent_views,
  review_items,
  review_logs,
  runTransaction,
  uploaded_images,
} from "./db";
import { appendBelow } from "./dashboardGrid";
import { nowUtc } from "./time";
import { normalizeLanguage } from "./languages";
import { clampRetention, DEFAULT_RETENTION } from "./fsrs";
import { subtreeFolderIds, wouldCreateCycle } from "./folderTree";
import type { QuizContent, FlashcardsContent, NotesContent, QuizGenerationSettings } from "./types";
import { deckDueCardIndices } from "./spacedRepetition";
import type { SourceTrust } from "./sources/types";
import { listAllCardDueRows } from "./review/store";
import { ensureFsrsMigrated } from "./review/legacyMigration";
import {
  DEFAULT_FOLDER_CHIPS,
  parseFolderChipSettings,
  serializeFolderChipSettings,
  type FolderChipSettings,
} from "./folderChips";
import { parseAppWallpaper, type AppWallpaperSettings } from "./appWallpaper";
import { parseHeaderTintMode, type HeaderTintMode } from "./headerTint";
import { parseDashboardLinks, type DashboardLink } from "./dashboardLinks";
import { LINK_BRAND_KEYS } from "./linkIcons";
import { isValidIconImage } from "./dataUrlImage";
import { clampBackdropBlur } from "./backdropBlur";
import { omitEmbeddedImages } from "./embeddedImages";
import { parseNoteLinks, stripNoteLinkSyntax } from "./noteLinks";
import { wikiLinksToTitle } from "./obsidianLinks";
import { canvasReferencesTarget, emptyCanvas, parseCanvasJson, type CanvasData } from "./canvas";

// "image" is distinct from "failed": a plain image (png/jpg/...) has no text
// to extract by design (no OCR — see extraction.ts), not a broken upload —
// it's still fully viewable and Crop & Ask-able, just never picked up as
// generation source material (see getNewDocumentsForItem/context.ts, both
// of which key off "extracted" specifically).
export type DocumentStatus = "pending" | "extracted" | "failed" | "image";
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
  // See the matching columns in db/schema.pg.ts. folder_chips is raw JSON —
  // read it through lib/folderChips.ts's parseFolderChipSettings.
  show_practice: boolean;
  lock_background_crop: boolean;
  folder_chips: string | null;
  created_at: string;
}

export interface Folder {
  id: number;
  course_id: number;
  name: string;
  position: number;
  // Non-null means this folder is a subfolder of another. Nesting can go
  // to any depth — see lib/folderTree.ts for the subtree helpers, and
  // nestFolder for the no-cycles rule.
  parent_folder_id: number | null;
  icon: string | null;
  color: string | null;
  created_at: string;
}

export class CannotNestFolderError extends Error {
  constructor() {
    super("A folder can't be moved inside itself or one of its own subfolders.");
    this.name = "CannotNestFolderError";
  }
}

// folder_id is null for a document/item/note filed directly on the course
// page rather than inside any folder — a real, intended state (not just an
// ON DELETE SET NULL fallback), same as source_folder_id below.
export interface DocumentRow {
  id: number;
  course_id: number;
  folder_id: number | null;
  position: number;
  filename: string;
  file_path: string;
  extracted_text: string | null;
  page_count: number | null;
  char_count: number | null;
  status: DocumentStatus;
  error_message: string | null;
  // See SourceTrust in lib/sources/types.ts.
  trust: SourceTrust;
  created_at: string;
}

export interface GeneratedItem {
  id: number;
  course_id: number;
  folder_id: number | null;
  position: number;
  mode: GenerationMode;
  title: string;
  content_json: string;
  source_document_ids: string;
  // The folder actually generated from — null means "all course material"
  // (pooled across every folder). See schema.sql for why this differs from
  // folder_id (where the item is filed).
  source_folder_id: number | null;
  // True for a hand-picked "choose documents" selection — also leaves
  // source_folder_id null, but distinct from pooled "all course material".
  // See schema.sql and getNewDocumentsForItem.
  source_handpicked: boolean;
  // Which AI backend/model produced this item — null for items generated
  // before this was tracked. See lib/aiClient.ts's getModelInfo().
  model_provider: AiBackend | null;
  model_name: string | null;
  // The study-plan chapter this was generated for, if any — see
  // lib/studyPlan/store.ts, which counts its results toward that chapter.
  study_plan_chapter_id: number | null;
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

// Re-exported for server code's convenience (e.g. api/settings/route.ts) —
// the canonical definition lives in aiBackendChoices.ts, kept out of this
// file so a client component can import it without dragging in the DB layer
// below (see that file's own comment).
export { IMAGE_CAPABLE_BACKENDS } from "./aiBackendChoices";

export type AiProviderKeyName = "anthropic" | "openai" | "gemini" | "openrouter";

interface SettingsRow {
  ai_provider: AiBackend;
  image_ai_provider: AiBackend | null;
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
  ai_grading_enabled: boolean;
  dashboard_transparent_widgets: boolean;
  dashboard_lock_background_crop: boolean;
  dashboard_backdrop_full_page: boolean;
  dashboard_backdrop_blur: number;
  unlimited_uploads: boolean;
  document_badges_enabled: boolean;
  document_badge_detail: string | null;
  folder_chips: string | null;
  app_wallpaper: string | null;
  header_tint: string | null;
  dashboard_links: string | null;
  hide_course_backdrops: boolean;
  hide_course_icons: boolean;
  ai_efficiency_mode: boolean;
  model_badge_detail: string | null;
  ai_enabled: boolean;
  cli_trusted_mode_enabled: boolean;
  preferred_language: string | null;
  review_retention: number | null;
  new_cards_per_day: number | null;
}

async function getSettingsRow(): Promise<SettingsRow | undefined> {
  const rows = await db
    .select({
      ai_provider: app_settings.ai_provider,
      image_ai_provider: app_settings.image_ai_provider,
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
      ai_grading_enabled: app_settings.ai_grading_enabled,
      dashboard_transparent_widgets: app_settings.dashboard_transparent_widgets,
      dashboard_lock_background_crop: app_settings.dashboard_lock_background_crop,
      dashboard_backdrop_full_page: app_settings.dashboard_backdrop_full_page,
      dashboard_backdrop_blur: app_settings.dashboard_backdrop_blur,
      unlimited_uploads: app_settings.unlimited_uploads,
      document_badges_enabled: app_settings.document_badges_enabled,
      document_badge_detail: app_settings.document_badge_detail,
      folder_chips: app_settings.folder_chips,
      app_wallpaper: app_settings.app_wallpaper,
      header_tint: app_settings.header_tint,
      dashboard_links: app_settings.dashboard_links,
      hide_course_backdrops: app_settings.hide_course_backdrops,
      hide_course_icons: app_settings.hide_course_icons,
      ai_efficiency_mode: app_settings.ai_efficiency_mode,
      model_badge_detail: app_settings.model_badge_detail,
      ai_enabled: app_settings.ai_enabled,
      cli_trusted_mode_enabled: app_settings.cli_trusted_mode_enabled,
      preferred_language: app_settings.preferred_language,
      review_retention: app_settings.review_retention,
      new_cards_per_day: app_settings.new_cards_per_day,
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

// Returns the raw override — null means "use ai_provider" (see
// AppSettings.imageAiBackend), left for aiClient.ts to resolve against the
// main backend rather than baking that fallback in here, since only it
// knows which calls actually carry images.
export async function getImageAiBackend(): Promise<AiBackend | null> {
  const row = await getSettingsRow();
  return row?.image_ai_provider ?? null;
}

// The master "AI enabled" switch (app_settings.ai_enabled, default true) —
// see AppSettings.aiEnabled's doc comment. Checked directly by
// aiClient.ts's generateStructured/generateText, the single choke point
// every AI call in the app goes through (generation, chat, grading, tidy
// text, ask-AI), so gating there covers all of them without each caller
// needing its own check.
export async function isAiEnabled(): Promise<boolean> {
  const row = await getSettingsRow();
  return row?.ai_enabled ?? true;
}

export async function setAiBackend(backend: AiBackend): Promise<void> {
  await db
    .update(app_settings)
    .set({ ai_provider: backend, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

// null clears the override back to "use ai_provider" (see
// AppSettings.imageAiBackend).
export async function setImageAiBackend(backend: AiBackend | null): Promise<void> {
  await db
    .update(app_settings)
    .set({ image_ai_provider: backend, updated_at: nowUtc() })
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
  // On (the default): every AI feature works as normal. Off: the master
  // switch for people who just want the app as a plain document/notes/
  // flashcards organizer — generation, chat, AI grading, "tidy with AI",
  // and ask-AI/hint/explain all hide from the UI and are refused
  // server-side too (see isAiEnabled, checked by aiClient.ts's
  // generateStructured/generateText, the one choke point every AI call in
  // the app goes through). Never affects document upload/extraction
  // (PDF/DOCX/PPTX parsing is local, not AI) or anything else non-AI.
  aiEnabled: boolean;
  aiBackend: AiBackend;
  // null (default): image-bearing requests (Crop & Ask) use aiBackend above
  // too, same as before this setting existed — except that throws if
  // aiBackend is claude_code/codex_cli, since neither can take image input
  // (see aiBackends/claudeCode.ts, codexCli.ts). A non-null value overrides
  // the backend for those requests only, to one of IMAGE_CAPABLE_BACKENDS,
  // without having to switch the main model away from a CLI-subscription
  // backend just to use Crop & Ask.
  imageAiBackend: AiBackend | null;
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
  // Off (the default): the backdrop banner sizes itself from the viewport
  // (full-bleed width, fixed or content-driven height) and crops with
  // ordinary CSS `background-size: cover` — which can visibly reframe on
  // browser zoom/window resize, since the container's aspect ratio isn't
  // perfectly stable. On: the banner is forced to the exact aspect ratio
  // the backdrop was cropped to at upload (see BACKGROUND_ASPECT in
  // lib/imageCropPresets.ts) and drawn unstretched, so the same crop always
  // shows regardless of zoom/resize — a fixed, content-independent height
  // rather than "overlap"'s own small fixed banner. Only meaningful for
  // dashboardBannerStyle "backdrop"; "overlap" already uses its own small
  // fixed-height banner regardless of this setting.
  dashboardLockBackgroundCrop: boolean;
  // Off (the default): the "backdrop" banner (locked crop or not) covers
  // the top widgets and the course grid, then fades into the plain page
  // background before the second widget zone below the course list (see
  // HomeWidgetConfig's "bottom" zone). On: it covers that second zone too,
  // reading as a true full-page backdrop rather than stopping partway down.
  // Meaningless for dashboardBannerStyle "overlap", which never spans past
  // its own small banner.
  dashboardBackdropFullPage: boolean;
  // Blur on the dashboard backdrop in px, 0 (the default) to
  // MAX_BACKDROP_BLUR — see lib/backdropBlur.ts.
  dashboardBackdropBlur: number;
  // Off (the default): every image upload is held to its kind's size cap
  // (lib/uploadLimits.ts) — oversized animations are compressed to fit and
  // still images are downscaled to what they're displayed at. On: no cap
  // and no downscaling, for anyone who wants originals at full resolution
  // and is fine with the storage/bandwidth that costs. A storage provider's
  // own per-file limit (e.g. Supabase's bucket setting) still applies.
  unlimitedUploads: boolean;
  // Off (the default): a short-answer quiz question is graded locally —
  // word-overlap against the model answer, no API call — instead of asking
  // the AI to judge it. Saves a grading call per quiz on every attempt;
  // trades away partial-credit nuance and written feedback for it. On:
  // today's original behavior (see lib/grading.ts's gradeShortAnswers).
  // Never affects mcq/multi_select, which are always graded locally either
  // way — this only ever changes short-answer questions.
  aiGradingEnabled: boolean;
  // Off (the default): every widget renders on its own solid card, same as
  // before this setting existed. On: widgets drop their card background/ring
  // (Card's own "flat" elevation) and sit directly on the dashboard's own
  // background — the plain page color, or dashboardBackgroundImage's backdrop
  // when one is set — like icons on a home screen rather than a stack of
  // panels.
  dashboardTransparentWidgets: boolean;
  // On (the default): document rows show their status badge — "extracted,
  // Np", "processing…", the failure error, or "image, not used for
  // generation" — same as before this setting existed. Off: no badge at all.
  documentBadgesEnabled: boolean;
  // "detailed" (default): the full status text above. "minimal": just the
  // page count ("Np") for extracted documents and just "image" for image
  // files — processing/failure text is short enough already and doesn't
  // shrink further. Meaningless with documentBadgesEnabled off.
  documentBadgeDetail: "detailed" | "minimal";
  // Which count tags (documents / generated / notes / subfolders) show
  // after folder names on course pages — see lib/folderChips.ts. A course
  // can override this with its own courses.folder_chips.
  folderChips: FolderChipSettings;
  // The dashboard backdrop reused as a fixed wallpaper behind other pages —
  // see lib/appWallpaper.ts. Meaningless with no dashboardBackgroundImage.
  appWallpaper: AppWallpaperSettings;
  // How the nav bar is colored over the backdrop and wallpaper — see
  // lib/headerTint.ts.
  headerTint: HeaderTintMode;
  // The dashboard Links widget's shortcuts — see lib/dashboardLinks.ts.
  dashboardLinks: DashboardLink[];
  // Hide every course's own backdrop/cover banner, and/or its icon, on
  // course pages — see lib/coursePageDisplay.ts.
  hideCourseBackdrops: boolean;
  hideCourseIcons: boolean;
  // Off (the default): generation/chat calls use the main model at their
  // normal effort/maxTokens, same as before this setting existed. On: every
  // AI call in lib/generate.ts and lib/chat.ts asks its backend for a
  // cheaper/faster model where one exists (see `efficient` in
  // aiBackends/types.ts) and drops effort/maxTokens — a blunt cost lever for
  // people who'd rather save tokens than get today's default quality. Never
  // touches the source text/input fed to the model, only how hard it thinks
  // and which model answers.
  aiEfficiencyMode: boolean;
  // "detailed" (default): the model badge shows its provider logo and full
  // label/model text, same as before this setting existed. "minimal": just
  // the logo/icon, no text. Meaningless with showModelBadge off.
  modelBadgeDetail: "detailed" | "minimal";
  // Off (the default): the claude_code/codex_cli backends run hardened — no
  // Bash/Read/Write/Edit/network tools, in a throwaway os.tmpdir() cwd (see
  // HARDENING_ARGS in aiBackends/claudeCode.ts and aiBackends/codexCli.ts).
  // On: those backends run with their normal full tool permissions, confined
  // to a dedicated, disposable workspace directory under data/ai-workspace/
  // (see aiBackends/cliWorkspace.ts) that's materialized with the relevant
  // course documents/images and a manifest.json lookup table — never the
  // app's own project source, database, or .env. Also lets those backends
  // accept image input (crop-to-ask, chat image attachments) by writing the
  // image into that same workspace instead of refusing it outright.
  // Meaningless for every other backend. This is a real trust boundary, not
  // just a convenience flag — a malicious PDF/prompt could try to abuse the
  // unlocked tools, so it's opt-in and off by default.
  cliTrustedModeEnabled: boolean;
  // BCP-47 code from lib/languages.ts — "en" when never set. What AI-written
  // study plans are written in, and which language learning resources are
  // preferred in (falling back to English where little exists).
  preferredLanguage: string;
  // FSRS target retention — the recall probability reviews are scheduled
  // to keep each card/question at (lib/fsrs.ts). Higher means more reviews.
  reviewRetention: number;
  // How many never-reviewed cards the review session introduces a day.
  newCardsPerDay: number;
}

export async function getAppSettings(): Promise<AppSettings> {
  const row = await getSettingsRow();
  const feeds = await listCalendarFeeds();
  return {
    aiEnabled: row?.ai_enabled ?? true,
    aiBackend: row?.ai_provider ?? "api",
    imageAiBackend: row?.image_ai_provider ?? null,
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
    aiGradingEnabled: row?.ai_grading_enabled ?? false,
    dashboardTransparentWidgets: row?.dashboard_transparent_widgets ?? false,
    dashboardLockBackgroundCrop: row?.dashboard_lock_background_crop ?? false,
    dashboardBackdropFullPage: row?.dashboard_backdrop_full_page ?? false,
    dashboardBackdropBlur: clampBackdropBlur(row?.dashboard_backdrop_blur ?? 0),
    unlimitedUploads: row?.unlimited_uploads ?? false,
    documentBadgesEnabled: row?.document_badges_enabled ?? true,
    documentBadgeDetail: row?.document_badge_detail === "minimal" ? "minimal" : "detailed",
    folderChips: parseFolderChipSettings(row?.folder_chips) ?? DEFAULT_FOLDER_CHIPS,
    appWallpaper: parseAppWallpaper(row?.app_wallpaper),
    headerTint: parseHeaderTintMode(row?.header_tint),
    hideCourseBackdrops: row?.hide_course_backdrops ?? false,
    hideCourseIcons: row?.hide_course_icons ?? false,
    dashboardLinks: parseDashboardLinks(row?.dashboard_links, {
      brandKeys: LINK_BRAND_KEYS,
      isValidImageUrl: isValidIconImage,
    }),
    aiEfficiencyMode: row?.ai_efficiency_mode ?? false,
    modelBadgeDetail: row?.model_badge_detail === "minimal" ? "minimal" : "detailed",
    cliTrustedModeEnabled: row?.cli_trusted_mode_enabled ?? false,
    preferredLanguage: normalizeLanguage(row?.preferred_language),
    reviewRetention: clampRetention(row?.review_retention ?? DEFAULT_RETENTION),
    newCardsPerDay: clampNewCardsPerDay(row?.new_cards_per_day ?? DEFAULT_NEW_CARDS_PER_DAY),
  };
}

export async function setAiEnabled(enabled: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ ai_enabled: enabled, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
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

export async function setUnlimitedUploads(enabled: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ unlimited_uploads: enabled, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setAiGradingEnabled(enabled: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ ai_grading_enabled: enabled, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setDocumentBadgesEnabled(enabled: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ document_badges_enabled: enabled, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setDocumentBadgeDetail(detail: "detailed" | "minimal"): Promise<void> {
  await db
    .update(app_settings)
    .set({ document_badge_detail: detail === "minimal" ? "minimal" : null, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setFolderChips(settings: FolderChipSettings): Promise<void> {
  await db
    .update(app_settings)
    .set({ folder_chips: serializeFolderChipSettings(settings), updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setCoursePageDisplay(fields: {
  hideCourseBackdrops?: boolean;
  hideCourseIcons?: boolean;
}): Promise<void> {
  const set: { hide_course_backdrops?: boolean; hide_course_icons?: boolean } = {};
  if (fields.hideCourseBackdrops !== undefined) set.hide_course_backdrops = fields.hideCourseBackdrops;
  if (fields.hideCourseIcons !== undefined) set.hide_course_icons = fields.hideCourseIcons;
  if (Object.keys(set).length === 0) return;
  await db
    .update(app_settings)
    .set({ ...set, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setDashboardLinks(links: DashboardLink[]): Promise<void> {
  await db
    .update(app_settings)
    .set({ dashboard_links: JSON.stringify(links), updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setHeaderTint(mode: HeaderTintMode): Promise<void> {
  await db
    .update(app_settings)
    .set({ header_tint: mode === "static" ? null : mode, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setAppWallpaper(settings: AppWallpaperSettings): Promise<void> {
  await db
    .update(app_settings)
    .set({ app_wallpaper: JSON.stringify(settings), updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setAiEfficiencyMode(enabled: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ ai_efficiency_mode: enabled, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setCliTrustedModeEnabled(enabled: boolean): Promise<void> {
  await db
    .update(app_settings)
    .set({ cli_trusted_mode_enabled: enabled, updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export async function setPreferredLanguage(code: string): Promise<void> {
  await db
    .update(app_settings)
    .set({ preferred_language: normalizeLanguage(code), updated_at: nowUtc() })
    .where(eq(app_settings.id, 1));
}

export const DEFAULT_NEW_CARDS_PER_DAY = 20;
export const MAX_NEW_CARDS_PER_DAY = 200;

export function clampNewCardsPerDay(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NEW_CARDS_PER_DAY;
  return Math.min(MAX_NEW_CARDS_PER_DAY, Math.max(0, Math.round(value)));
}

export async function setReviewSettings(settings: { retention?: number; newCardsPerDay?: number }): Promise<void> {
  await db
    .update(app_settings)
    .set({
      ...(settings.retention !== undefined && { review_retention: clampRetention(settings.retention) }),
      ...(settings.newCardsPerDay !== undefined && { new_cards_per_day: clampNewCardsPerDay(settings.newCardsPerDay) }),
      updated_at: nowUtc(),
    })
    .where(eq(app_settings.id, 1));
}

export async function setModelBadgeDetail(detail: "detailed" | "minimal"): Promise<void> {
  await db
    .update(app_settings)
    .set({ model_badge_detail: detail === "minimal" ? "minimal" : null, updated_at: nowUtc() })
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
  dashboardTransparentWidgets?: boolean;
  dashboardLockBackgroundCrop?: boolean;
  dashboardBackdropFullPage?: boolean;
  dashboardBackdropBlur?: number;
}): Promise<void> {
  const values: Record<string, string | number | boolean | null> = {};
  if ("appName" in fields) values.app_name = fields.appName ?? null;
  if ("appIcon" in fields) values.app_icon = fields.appIcon ?? null;
  if ("appIconImage" in fields) values.app_icon_image = fields.appIconImage ?? null;
  if ("appFont" in fields) values.app_font = fields.appFont ?? null;
  if ("dashboardBackgroundImage" in fields) values.dashboard_background_image = fields.dashboardBackgroundImage ?? null;
  if ("dashboardBannerStyle" in fields) values.dashboard_banner_style = fields.dashboardBannerStyle ?? null;
  if ("dashboardTransparentWidgets" in fields) values.dashboard_transparent_widgets = fields.dashboardTransparentWidgets ?? false;
  if ("dashboardLockBackgroundCrop" in fields) values.dashboard_lock_background_crop = fields.dashboardLockBackgroundCrop ?? false;
  if ("dashboardBackdropFullPage" in fields) values.dashboard_backdrop_full_page = fields.dashboardBackdropFullPage ?? false;
  if ("dashboardBackdropBlur" in fields) values.dashboard_backdrop_blur = clampBackdropBlur(fields.dashboardBackdropBlur ?? 0);
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
  // Master switch — off means this feed is skipped entirely wherever feeds
  // get fetched (see fetchAllFeedEvents' caller), not just hidden from one
  // place the way show_on_calendar/show_in_widget are. Defaults true, same
  // as those two.
  enabled: boolean;
  // Gives this feed its own /calendar tab; calendar_config is that tab's
  // settings as raw JSON text — read it through parseFeedCalendarConfig
  // (lib/feedCalendar.ts), which fills in defaults for anything missing.
  own_calendar: boolean;
  calendar_config: string | null;
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

export async function updateCalendarFeed(
  id: number,
  fields: {
    show_on_calendar?: boolean;
    show_in_widget?: boolean;
    enabled?: boolean;
    own_calendar?: boolean;
    calendar_config?: string;
  }
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

export type RecentViewType = "note" | "document" | "item" | "canvas";

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
  const canvasIds = rows.filter((r) => r.item_type === "canvas").map((r) => r.item_id);

  const [noteRows, docRows, itemRows, canvasRows] = await Promise.all([
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
    canvasIds.length
      ? db
          .select({ id: canvases.id, title: canvases.title, course_id: canvases.course_id, course_name: courses.name })
          .from(canvases)
          .leftJoin(courses, eq(canvases.course_id, courses.id))
          .where(inArray(canvases.id, canvasIds))
      : Promise.resolve([]),
  ]);

  const noteMap = new Map(noteRows.map((r) => [r.id, r]));
  const docMap = new Map(docRows.map((r) => [r.id, r]));
  const itemMap = new Map(itemRows.map((r) => [r.id, r]));
  const canvasMap = new Map(canvasRows.map((r) => [r.id, r]));

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
    } else if (row.item_type === "canvas") {
      const c = canvasMap.get(row.item_id);
      if (c) {
        result.push({ type: "canvas", id: c.id, title: c.title, courseId: c.course_id, courseName: c.course_name ?? "", viewedAt: row.viewed_at });
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

export type UploadedImageKind = "icon" | "cover" | "background" | "note";

export interface UploadedImage {
  id: number;
  kind: UploadedImageKind;
  // Either a real blob-storage URL or (no blob store configured, see
  // src/lib/blobStorage) a data: URL — the underlying `data_url` DB column
  // name predates that and is left as-is (purely internal, an app-facing
  // rename isn't worth its own schema migration), but everywhere this
  // value is read from or written to JS, it's called `url` now.
  url: string;
  createdAt: string;
}

export async function listUploadedImages(kind: UploadedImageKind, limit = 40): Promise<UploadedImage[]> {
  const rows = await db
    .select()
    .from(uploaded_images)
    .where(eq(uploaded_images.kind, kind))
    .orderBy(desc(uploaded_images.created_at), desc(uploaded_images.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind as UploadedImageKind, url: r.data_url, createdAt: r.created_at }));
}

export async function recordUploadedImage(kind: UploadedImageKind, url: string): Promise<UploadedImage> {
  const created_at = nowUtc();
  const [row] = await db.insert(uploaded_images).values({ kind, data_url: url, created_at }).returning();
  return { id: row.id, kind, url, createdAt: created_at };
}

export async function deleteUploadedImage(id: number): Promise<void> {
  await db.delete(uploaded_images).where(eq(uploaded_images.id, id));
}

// Looks up one image by id regardless of kind — used to resolve a
// studybuddy-image:<id> reference embedded in a note's markdown (see
// NoteEditor.tsx) back into a real URL for rendering, since the note's own
// source text only ever carries the short id, not the (often huge) data URL
// or the blob-storage URL itself.
export async function getUploadedImage(id: number): Promise<UploadedImage | undefined> {
  const [row] = await db.select().from(uploaded_images).where(eq(uploaded_images.id, id)).limit(1);
  if (!row) return undefined;
  return { id: row.id, kind: row.kind as UploadedImageKind, url: row.data_url, createdAt: row.created_at };
}

// True if `url` is still the current value of any course's cover/icon/
// background image, the app's branding icon or dashboard backdrop, a
// dashboard link's uploaded icon, or any uploaded_images library row — checked before actually deleting a blob
// (see src/lib/blobStorage/cleanup.ts) so replacing one field's image can
// never delete a blob that's still in use somewhere else. The same URL
// legitimately ends up in more than one place: every crop-and-save in
// CustomizeCourseDialog/SettingsDialog also records a library entry
// pointing at that same URL, and picking an image from the library can
// point more than one course (or the app's own branding) at it.
export async function isImageUrlReferenced(url: string): Promise<boolean> {
  const [courseRows, uploadedRows, settings] = await Promise.all([
    db
      .select({ id: courses.id })
      .from(courses)
      .where(
        or(eq(courses.cover_image, url), eq(courses.icon_image, url), eq(courses.page_background_image, url))
      )
      .limit(1),
    db.select({ id: uploaded_images.id }).from(uploaded_images).where(eq(uploaded_images.data_url, url)).limit(1),
    getAppSettings(),
  ]);
  if (courseRows.length > 0 || uploadedRows.length > 0) return true;
  return (
    settings.appIconImage === url ||
    settings.dashboardBackgroundImage === url ||
    settings.dashboardLinks.some((link) => link.icon === `image:${url}`)
  );
}

// True if any note embeds this uploaded_images row via a
// studybuddy-image:<id> reference (see NOTE_IMAGE_SCHEME in NoteEditor.tsx)
// — checked before letting the library picker (DELETE /api/uploaded-images/
// [id]) delete a row, since isImageUrlReferenced above only looks at course/
// branding fields and other uploaded_images rows, never note content. Keyed
// by the row's id (what notes actually embed), not its data_url (what
// isImageUrlReferenced checks) — same scan-every-note's-markdown approach as
// getNoteBacklinks, since there's no denormalized index of note image
// embeds either. The negative lookahead keeps id=1 from matching inside
// id=12's reference.
//
// Canvases count too: an image card ("image:<id>") or a studybuddy-image
// embed inside a canvas text card holds the row just as firmly as a note
// does — missing that would let the library picker delete an image a
// canvas is still showing.
export async function isUploadedImageReferencedInContent(id: number): Promise<boolean> {
  const [noteRows, canvasRows] = await Promise.all([
    db.select({ markdown: notes.markdown }).from(notes),
    db.select({ data: canvases.data }).from(canvases),
  ]);
  const pattern = new RegExp(`studybuddy-image:${id}(?!\\d)`);
  if (noteRows.some((row) => pattern.test(row.markdown))) return true;
  return canvasRows.some((row) => canvasReferencesTarget(parseCanvasJson(row.data), { type: "image", id }));
}

// Migration-only (see /api/storage-settings/migrate-images): every
// uploaded_images row across every kind, unlike listUploadedImages which is
// always scoped to one kind for the library picker.
export async function listAllUploadedImages(): Promise<UploadedImage[]> {
  const rows = await db.select().from(uploaded_images);
  return rows.map((r) => ({ id: r.id, kind: r.kind as UploadedImageKind, url: r.data_url, createdAt: r.created_at }));
}

// Migration-only — rewrites an existing row's url in place (e.g. a data:
// URL replaced by the blob-storage URL it was just uploaded to), unlike
// recordUploadedImage which always inserts a new row.
export async function updateUploadedImageUrl(id: number, url: string): Promise<void> {
  await db.update(uploaded_images).set({ data_url: url }).where(eq(uploaded_images.id, id));
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
  folder_id: number | null;
  position: number;
  title: string;
  markdown: string;
  icon: string | null;
  // Null: not used for generation; otherwise included with that trust.
  generation_source: SourceTrust | null;
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

// folder_id null means "filed directly on the course page" — a real,
// intended state (see DocumentRow's doc comment), not matchable with plain
// eq() the way a real folder id is.
function folderPredicate(column: AnySQLiteColumn, folderId: number | null) {
  return folderId === null ? isNull(column) : eq(column, folderId);
}

async function assertTitleAvailable(title: string, excludeId?: number): Promise<void> {
  const existing = await db.select().from(notes);
  const collision = existing.find(
    (n) => n.id !== excludeId && n.title.toLowerCase() === title.toLowerCase()
  );
  if (collision) throw new Error(`A note titled "${title}" already exists`);
}

// Same pattern as nextDocumentPosition — a newly created (or moved) note
// lands at the end of its destination folder (or, for folderId null, the
// end of the course's top-level "on the course page" list).
async function nextNotePosition(courseId: number, folderId: number | null, tx: typeof db = db): Promise<number> {
  const [{ next }] = await tx
    .select({ next: sql<number>`COALESCE(MAX(${notes.position}), -1) + 1` })
    .from(notes)
    .where(and(eq(notes.course_id, courseId), folderPredicate(notes.folder_id, folderId)));
  return next;
}

export async function createNote(
  title: string,
  courseId: number,
  folderId?: number | null,
  markdown = ""
): Promise<Note> {
  await assertTitleAvailable(title);
  // moveNote validates this same invariant on the move path (see its own
  // comment) — createNote let an explicit folderId through unchecked, so a
  // crafted request could create a note whose course_id disagrees with its
  // own folder's course_id.
  if (folderId != null) {
    const folder = await getFolder(folderId);
    if (!folder || folder.course_id !== courseId) {
      throw new InvalidDestinationFolderError();
    }
  }
  const resolvedFolderId = folderId ?? null;
  const now = nowUtc();
  // Same atomicity concern as createDocument — see its comment.
  const note = await runTransaction(async (tx) => {
    const [row] = await tx
      .insert(notes)
      .values({
        title,
        markdown,
        course_id: courseId,
        folder_id: resolvedFolderId,
        position: await nextNotePosition(courseId, resolvedFolderId, tx),
        created_at: now,
        updated_at: now,
      })
      .returning();
    return row;
  });
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

// Doesn't touch updated_at: whether a note feeds generation isn't an edit
// to the note itself.
export async function setNoteGenerationSource(id: number, source: SourceTrust | null): Promise<void> {
  await db.update(notes).set({ generation_source: source }).where(eq(notes.id, id));
}

export async function setDocumentTrust(id: number, trust: SourceTrust): Promise<void> {
  await db.update(documents).set({ trust }).where(eq(documents.id, id));
}

// Lands at the end of the destination folder (or the course's top-level
// list, for folderId null — "un-filing" a note back onto the course page is
// always a valid move, so there's nothing to check against) — same as
// moveDocument.
export async function moveNote(id: number, folderId: number | null): Promise<void> {
  const note = await getNote(id);
  if (!note) return;
  if (folderId != null) {
    const destination = await getFolder(folderId);
    if (!destination || destination.course_id !== note.course_id) {
      throw new InvalidDestinationFolderError();
    }
  }
  // Same atomicity concern as moveDocument — see its comment.
  await runTransaction(async (tx) => {
    await tx
      .update(notes)
      .set({ folder_id: folderId, position: await nextNotePosition(note.course_id, folderId, tx) })
      .where(eq(notes.id, id));
  });
}

// Same pattern as reorderDocuments — scoped to one folder at a time.
// A "CASE id WHEN … THEN … END" SQL expression mapping each ordered id to
// its new position — lets every reorder* function below issue a single
// batched UPDATE instead of one UPDATE per item being reordered. Standard
// SQL, so it works unchanged against both the SQLite and Postgres backends
// (see db/index.ts's note on the shared table typing this relies on).
//
// The explicit CAST on each THEN value is load-bearing on Postgres:
// postgres.js binds plain JS numbers as untyped parameters, and a CASE whose
// every branch is untyped resolves to text — so without it, Postgres
// rejected every reorder ("column "position" is of type integer but
// expression is of type text") while SQLite, which the test suite runs on,
// accepted it. CAST(... AS INTEGER) is the spelling both dialects accept
// (SQLite has no ::integer).
export function positionCases(idColumn: AnySQLiteColumn, orderedIds: number[]) {
  return sql.join(
    [
      sql`CASE ${idColumn}`,
      ...orderedIds.map((id, index) => sql`WHEN ${id} THEN CAST(${index} AS INTEGER)`),
      sql`END`,
    ],
    sql` `
  );
}

export async function reorderNotes(courseId: number, folderId: number | null, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(notes)
    .set({ position: positionCases(notes.id, orderedIds) })
    .where(
      and(eq(notes.course_id, courseId), folderPredicate(notes.folder_id, folderId), inArray(notes.id, orderedIds))
    );
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
  const all = await db.select().from(notes);
  const title = all.find((n) => n.id === id)?.title;
  const backlinks: NoteBacklink[] = [];
  for (const other of all) {
    if (other.id === id) continue;
    // Both link syntaxes count: the app's own [[note:ID]] and an Obsidian-
    // style [[Title]] naming this note (see lib/obsidianLinks.ts).
    const starts = parseNoteLinks(other.markdown)
      .filter((link) => link.type === "note" && link.id === id)
      .map((link) => link.start);
    if (title) starts.push(...wikiLinksToTitle(other.markdown, title).map((link) => link.start));
    for (const start of starts.sort((a, b) => a - b)) {
      backlinks.push({
        noteId: other.id,
        noteTitle: other.title,
        courseId: other.course_id!,
        context: backlinkContext(other.markdown, start),
      });
    }
  }
  return backlinks;
}

// --- Canvases: Obsidian-style boards of cards and arrows ---
// Organized per course like notes, but in their own section of the course
// page rather than inside the folder tree (so no folder_id). The board
// itself is one JSON Canvas document in `data` — see lib/canvas.ts for the
// format and schema.sql for why it's a single column.

export interface CanvasSummary {
  id: number;
  course_id: number;
  position: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Canvas extends CanvasSummary {
  data: CanvasData;
}

const canvasSummaryColumns = () => ({
  id: canvases.id,
  course_id: canvases.course_id,
  position: canvases.position,
  title: canvases.title,
  created_at: canvases.created_at,
  updated_at: canvases.updated_at,
});

export async function getCanvas(id: number): Promise<Canvas | undefined> {
  const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
  if (!row) return undefined;
  return { ...row, data: parseCanvasJson(row.data) };
}

// Summaries only — the course page lists canvases by title and never needs
// what's on them, and a busy board's JSON can be large.
export async function listCanvasesForCourse(courseId: number): Promise<CanvasSummary[]> {
  return db
    .select(canvasSummaryColumns())
    .from(canvases)
    .where(eq(canvases.course_id, courseId))
    .orderBy(asc(canvases.position), desc(canvases.created_at));
}

export async function createCanvas(title: string, courseId: number, data: CanvasData = emptyCanvas()): Promise<Canvas> {
  const now = nowUtc();
  // Same atomicity concern as createNote — the position read and the insert
  // have to happen together or two quick creates land on the same slot.
  const row = await runTransaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`COALESCE(MAX(${canvases.position}), -1) + 1` })
      .from(canvases)
      .where(eq(canvases.course_id, courseId));
    const [inserted] = await tx
      .insert(canvases)
      .values({
        title,
        course_id: courseId,
        position: next,
        data: JSON.stringify(data),
        created_at: now,
        updated_at: now,
      })
      .returning();
    return inserted;
  });
  return { ...row, data: parseCanvasJson(row.data) };
}

export async function renameCanvas(id: number, title: string): Promise<void> {
  await db.update(canvases).set({ title, updated_at: nowUtc() }).where(eq(canvases.id, id));
}

// Callers pass data that's already been through sanitizeCanvasData — this
// stores it as-is.
export async function updateCanvasData(id: number, data: CanvasData): Promise<void> {
  await db.update(canvases).set({ data: JSON.stringify(data), updated_at: nowUtc() }).where(eq(canvases.id, id));
}

export async function reorderCanvases(courseId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(canvases)
    .set({ position: positionCases(canvases.id, orderedIds) })
    .where(and(eq(canvases.course_id, courseId), inArray(canvases.id, orderedIds)));
}

export async function deleteCanvas(id: number): Promise<void> {
  await db.delete(canvases).where(eq(canvases.id, id));
}

export interface CanvasBacklink {
  canvasId: number;
  canvasTitle: string;
  courseId: number;
}

// Canvases that show this note, either as a whole card or via a [[note:id]]
// link inside a text card — Obsidian lists a canvas embedding a note among
// that note's backlinks, and so does the Vault. Same scan-everything,
// compute-at-read-time approach as getNoteBacklinks.
export async function getCanvasBacklinksForNote(noteId: number): Promise<CanvasBacklink[]> {
  const rows = await db.select().from(canvases);
  return rows
    .filter((row) => canvasReferencesTarget(parseCanvasJson(row.data), { type: "note", id: noteId }))
    .map((row) => ({ canvasId: row.id, canvasTitle: row.title, courseId: row.course_id }));
}

export interface LinkTargets {
  notes: { id: number; title: string; courseId: number; courseName: string }[];
  documents: { id: number; filename: string; courseId: number; courseName: string }[];
  items: { id: number; title: string; courseId: number; courseName: string; mode: GenerationMode }[];
}

// Powers the Vault editor's "[[" note completion and its "Insert link"
// dialog (documents, generated items, and notes) — one small full listing
// rather than a search-as-you-type endpoint, since a personal vault/course
// library is small enough to filter client-side (matches how Combobox is
// used elsewhere in this app).
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

export const HOME_WIDGET_IDS = [
  "streak",
  "due",
  "heatmap",
  "calendar",
  "assignments",
  "recent",
  "pomodoro",
  "links",
  "timetable",
] as const;
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
  { id: "pomodoro", enabled: true, zone: "top", col: 0, row: 6, colSpan: 3, rowSpan: 2 },
  // Starts hidden: it's empty until links are added, so it's opted into
  // from Customize rather than appearing blank on every dashboard.
  { id: "links", enabled: false, zone: "top", col: 3, row: 6, colSpan: 3, rowSpan: 2 },
  // Starts hidden for the same reason: it needs a feed with its own
  // /calendar tab (Settings → Calendar feeds → "Own tab") before it has
  // anything to show.
  { id: "timetable", enabled: false, zone: "top", col: 0, row: 8, colSpan: 6, rowSpan: 2 },
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
    return appendBelow([...known.values()], missing);
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

// A new course starts with zero folders — an empty course page shows
// nothing until something's actually added, filed directly on the page
// itself (folder_id null) until the user organizes it into a real folder.
// New courses are prepended (position below every existing course) rather
// than appended, so a course you just created still shows up first — the
// "newest first" behavior this app had before manual ordering existed.
export async function createCourse(name: string): Promise<Course> {
  const [{ next }] = await db
    .select({ next: sql<number>`COALESCE(MIN(${courses.position}), 1) - 1` })
    .from(courses);
  const [course] = await db
    .insert(courses)
    .values({ name, position: next, created_at: nowUtc() })
    .returning();
  return course;
}

export async function getCourse(id: number): Promise<Course | undefined> {
  const rows = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  return rows[0];
}

// The one field listCourseSummaries leaves out (see its own comment) —
// fetched narrowly, only while CustomizeCourseDialog is actually open,
// rather than through getCourse's full row (which would also mean paying
// for cover_image/icon_image a second time on top of what the dashboard
// list already sent) or the course page's own bundle (which would mean
// pulling its folders/documents/items/notes just to open an image picker).
export async function getCoursePageBackground(id: number): Promise<string | null | undefined> {
  const rows = await db
    .select({ page_background_image: courses.page_background_image })
    .from(courses)
    .where(eq(courses.id, id))
    .limit(1);
  return rows[0]?.page_background_image;
}

export type CourseSummary = Omit<Course, "page_background_image">;

// For the home dashboard's course grid — page_background_image (the course
// page's own full-bleed backdrop, capped at 4MB) is never rendered on a
// dashboard card, only on that course's own page (see getCourse, still the
// full version). cover_image/icon_image stay: the dashboard card does render
// those directly, so unlike page_background_image they can't be dropped
// here without an actual behavior change — cutting the egress they cost on
// every dashboard load needs moving image storage off Postgres entirely
// (e.g. Supabase Storage, with real HTTP caching), not a narrower SELECT.
export async function listCourseSummaries(): Promise<CourseSummary[]> {
  return db
    .select({
      id: courses.id,
      name: courses.name,
      position: courses.position,
      icon: courses.icon,
      color: courses.color,
      cover_image: courses.cover_image,
      icon_image: courses.icon_image,
      show_cover_on_card: courses.show_cover_on_card,
      show_icon_frame: courses.show_icon_frame,
      show_practice: courses.show_practice,
      lock_background_crop: courses.lock_background_crop,
      folder_chips: courses.folder_chips,
      created_at: courses.created_at,
    })
    .from(courses)
    .orderBy(asc(courses.position), desc(courses.created_at));
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
    show_practice?: boolean;
    lock_background_crop?: boolean;
    folder_chips?: string | null;
  }
): Promise<void> {
  await db.update(courses).set(fields).where(eq(courses.id, id));
}

// Applies a new drag-and-drop order in one transaction, same pattern as
// reorderFolders below.
export async function reorderCourses(orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(courses)
    .set({ position: positionCases(courses.id, orderedIds) })
    .where(inArray(courses.id, orderedIds));
}

export async function deleteCourse(id: number): Promise<void> {
  await db.delete(courses).where(eq(courses.id, id));
}

// --- Folders ---
// One tree per course: a folder holds both its documents and its generated
// items directly (see lib/generate.ts and lib/context.ts). Filing something
// with no folder chosen leaves its folder_id null — it renders directly on
// the course page instead of inside any folder (see DocumentRow's doc
// comment).

export async function createFolder(
  courseId: number,
  name: string,
  parentFolderId?: number | null
): Promise<Folder> {
  if (parentFolderId != null) {
    const parent = await getFolder(parentFolderId);
    if (!parent || parent.course_id !== courseId) {
      // Same invariant moveDocument/moveNote/moveGeneratedItem already
      // enforce on the move path — without this, a crafted parentFolderId
      // from a different course creates a folder that's filed under this
      // course (course_id === courseId) but nested under a parent from
      // another course entirely. It then renders nowhere (the course page
      // only groups subfolders by parent within that same course), leaving
      // a permanently invisible orphan.
      throw new InvalidDestinationFolderError();
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

// Thrown by moveDocument/moveNote/moveGeneratedItem when the requested
// destination folder doesn't exist or belongs to a different course than
// the item being moved — generateForCourse (generate.ts) already guards its
// own destinationFolderId this way; this is the same check for the plain
// drag-and-drop move endpoints, which previously only validated that
// folderId was an integer, letting a document/note/item end up with a
// course_id that disagreed with its own folder's course_id.
export class InvalidDestinationFolderError extends Error {
  constructor() {
    super("That destination folder no longer exists.");
    this.name = "InvalidDestinationFolderError";
  }
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
// distinct from onReorder (dropping into the gap between cards). Nesting
// can go to any depth, and a moved folder takes its whole subtree along;
// the one rule is no cycles — a folder can't be nested inside itself or
// anything already nested under it.
// parentFolderId: null un-nests (moves a subfolder back to top level) — no
// validation needed there, any folder can always become top-level again.
export async function nestFolder(id: number, parentFolderId: number | null): Promise<void> {
  const folder = await getFolder(id);
  if (!folder) return;

  if (parentFolderId == null) {
    await db.update(folders).set({ parent_folder_id: null }).where(eq(folders.id, id));
    return;
  }
  if (id === parentFolderId) return;
  const parent = await getFolder(parentFolderId);
  // A parent from a different course is treated the same as "not found" —
  // consistent with this function's existing style of silently no-opping on
  // an invalid target rather than throwing (see the !parent check above).
  // Without this, nesting could produce a folder whose course_id disagrees
  // with its own parent's course_id, same invisible-orphan risk createFolder
  // guards against on the create path.
  if (!parent || parent.course_id !== folder.course_id) return;
  if (wouldCreateCycle(await listFoldersForCourse(folder.course_id), id, parentFolderId)) {
    throw new CannotNestFolderError();
  }
  await db.update(folders).set({ parent_folder_id: parentFolderId }).where(eq(folders.id, id));
}

// Applies a new drag-and-drop order in one transaction. Any folder id not
// present in orderedIds (there shouldn't be one, but defensively) keeps its
// existing position rather than erroring.
export async function reorderFolders(courseId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(folders)
    .set({ position: positionCases(folders.id, orderedIds) })
    .where(and(eq(folders.course_id, courseId), inArray(folders.id, orderedIds)));
}

export async function listFoldersForCourse(courseId: number): Promise<Folder[]> {
  return db
    .select()
    .from(folders)
    .where(eq(folders.course_id, courseId))
    .orderBy(asc(folders.position), asc(folders.created_at));
}

// Deleting a folder never orphans anything: its documents/generated items/
// notes just move to the course page (folder_id null) instead of being
// deleted along with it.
export async function deleteFolder(id: number): Promise<void> {
  const folder = await getFolder(id);
  if (!folder) return;

  // Deleting a parent folder takes its whole subtree with it (every level
  // of subfolder under it) — every one of them needs its own documents/
  // items/notes moved to the course page first too, same as the parent.
  const targetIds = subtreeFolderIds(await listFoldersForCourse(folder.course_id), id);

  await runTransaction(async (tx) => {
    await tx.update(documents).set({ folder_id: null }).where(inArray(documents.folder_id, targetIds));
    await tx.update(generated_items).set({ folder_id: null }).where(inArray(generated_items.folder_id, targetIds));
    await tx.update(notes).set({ folder_id: null }).where(inArray(notes.folder_id, targetIds));
    await tx.delete(folders).where(inArray(folders.id, targetIds));
  });
}

// --- Documents ---

// Documents display oldest-first within a folder (see listDocumentsForCourse),
// so a newly uploaded/pasted/moved-in document appends to the end — same
// convention as folders' own position (see createFolder).
async function nextDocumentPosition(courseId: number, folderId: number | null, tx: typeof db = db): Promise<number> {
  const [{ next }] = await tx
    .select({ next: sql<number>`COALESCE(MAX(${documents.position}), -1) + 1` })
    .from(documents)
    .where(and(eq(documents.course_id, courseId), folderPredicate(documents.folder_id, folderId)));
  return next;
}

export async function createDocument(params: {
  courseId: number;
  folderId: number | null;
  filename: string;
  filePath: string;
  // null for pasted-text documents, which have no underlying file — see
  // POST .../documents/paste/route.ts.
  fileBase64: string | null;
}): Promise<DocumentRow> {
  // Same invariant moveDocument enforces on the move path — an explicit
  // folderId here (from either the file-upload or paste-text route) was
  // otherwise never checked against courseId, letting a crafted request
  // create a document whose course_id disagrees with its own folder's
  // course_id. No check needed when folderId is null — filing directly on
  // the course page is always valid.
  if (params.folderId != null) {
    const folder = await getFolder(params.folderId);
    if (!folder || folder.course_id !== params.courseId) {
      throw new InvalidDestinationFolderError();
    }
  }
  // Reading the next position and inserting at it must be atomic — two
  // concurrent uploads into the same folder (e.g. a multi-file
  // drag-and-drop) could otherwise both read the same MAX(position) before
  // either insert, landing both documents at the same position.
  const doc = await runTransaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        course_id: params.courseId,
        folder_id: params.folderId,
        position: await nextDocumentPosition(params.courseId, params.folderId, tx),
        filename: params.filename,
        file_path: params.filePath,
        file_base64: params.fileBase64,
        status: "pending",
        created_at: nowUtc(),
      })
      .returning();
    return row;
  });
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

// Reads a document's original bytes: the local on-disk copy if this is the
// device it was uploaded from (fast path, works offline), else the synced
// file_base64 copy from the database. Neither present -> null. Shared by the
// document-viewing route and aiBackends/cliWorkspace.ts (materializing a
// trusted-CLI workspace needs the same fallback).
export async function getDocumentBytes(doc: {
  file_path: string;
  file_base64: string | null;
}): Promise<Buffer | null> {
  try {
    return await fs.readFile(doc.file_path);
  } catch {
    // Not on this device (ENOENT) — fall through to the synced copy.
  }
  if (doc.file_base64) {
    return Buffer.from(doc.file_base64, "base64");
  }
  return null;
}

export interface DocumentWithBytes {
  id: number;
  course_id: number;
  folder_id: number | null;
  filename: string;
  file_path: string;
  file_base64: string | null;
  status: DocumentStatus;
}

// Fetches an arbitrary set of documents by id, in whatever order the DB
// returns them, including file_base64 (unlike DocumentRow/listDocumentsForCourse,
// which deliberately omit it) — used by aiBackends/cliWorkspace.ts to
// materialize exactly the documents a generation call's workspaceScope
// names, regardless of which course/folder each one belongs to.
export async function getDocumentsByIds(ids: number[]): Promise<DocumentWithBytes[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: documents.id,
      course_id: documents.course_id,
      folder_id: documents.folder_id,
      filename: documents.filename,
      file_path: documents.file_path,
      file_base64: documents.file_base64,
      status: documents.status,
    })
    .from(documents)
    .where(inArray(documents.id, ids));
}

// Explicitly excludes file_base64 — this feeds both course-page document
// queries below, and a several-MB base64 blob per document in that response
// would be a serious payload (and, on the Supabase backend, database
// egress) regression.
const documentListColumns = {
  id: documents.id,
  course_id: documents.course_id,
  folder_id: documents.folder_id,
  position: documents.position,
  filename: documents.filename,
  file_path: documents.file_path,
  page_count: documents.page_count,
  char_count: documents.char_count,
  status: documents.status,
  error_message: documents.error_message,
  trust: documents.trust,
  created_at: documents.created_at,
};

export type DocumentSummaryRow = Omit<DocumentRow, "extracted_text">;

// For the course page's document list — every row's full extracted_text
// (which can run tens of KB+ per document, sometimes far more) is not
// needed to render filename/status/page-count rows, only once a specific
// document is actually opened (see api/documents/[documentId]/route.ts,
// already fetched narrowly on demand by the document viewer for exactly
// this reason). listDocumentsForCourse below stays the full version, still
// used where the actual text is needed (generation context, data export).
export async function listDocumentSummariesForCourse(courseId: number): Promise<DocumentSummaryRow[]> {
  return db
    .select(documentListColumns)
    .from(documents)
    .where(eq(documents.course_id, courseId))
    .orderBy(asc(documents.position), asc(documents.created_at)) as Promise<DocumentSummaryRow[]>;
}

export async function listDocumentsForCourse(courseId: number): Promise<DocumentRow[]> {
  return db
    .select({ ...documentListColumns, extracted_text: documents.extracted_text })
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

export async function markDocumentImage(id: number): Promise<void> {
  await db
    .update(documents)
    .set({ status: "image", error_message: null })
    .where(eq(documents.id, id));
}

export async function deleteDocument(id: number): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id));
}

// Lands at the end of the destination folder (or the course's top-level
// list, for folderId null — un-filing a document back onto the course page
// is always valid, nothing to check against).
export async function moveDocument(id: number, folderId: number | null): Promise<void> {
  const doc = await getDocument(id);
  if (!doc) return;
  if (folderId != null) {
    const destination = await getFolder(folderId);
    if (!destination || destination.course_id !== doc.course_id) {
      throw new InvalidDestinationFolderError();
    }
  }
  // Same place a newly uploaded document would land, rather than keeping
  // whatever position number it happened to have in its old folder
  // (meaningless there). Wrapped in a transaction for the same reason as
  // createDocument — two concurrent moves into the same folder must not
  // read the same next position.
  await runTransaction(async (tx) => {
    await tx
      .update(documents)
      .set({ folder_id: folderId, position: await nextDocumentPosition(doc.course_id, folderId, tx) })
      .where(eq(documents.id, id));
  });
}

export async function renameDocument(id: number, filename: string): Promise<void> {
  await db.update(documents).set({ filename }).where(eq(documents.id, id));
}

// Applies a new drag-and-drop order in one transaction, same pattern as
// reorderFolders — scoped to one folder at a time (documents display
// per-folder, see listDocumentsForCourse), so `folderId` guards against
// reordering documents that aren't actually there.
export async function reorderDocuments(
  courseId: number,
  folderId: number | null,
  orderedIds: number[]
): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(documents)
    .set({ position: positionCases(documents.id, orderedIds) })
    .where(
      and(
        eq(documents.course_id, courseId),
        folderPredicate(documents.folder_id, folderId),
        inArray(documents.id, orderedIds)
      )
    );
}

// --- Generated items ---
// courseId is required on every read/write here by construction — see lib/context.ts
// for the single function allowed to assemble cross-document text for a course.

// Generated items display newest-first within a folder (see
// listGeneratedItemsForCourse), so a newly generated/moved-in item prepends
// to the front — mirrors courses' own "prepend" position convention (see
// createCourse) rather than documents' "append" one.
async function nextGeneratedItemPosition(
  courseId: number,
  folderId: number | null,
  tx: typeof db = db
): Promise<number> {
  const [{ next }] = await tx
    .select({ next: sql<number>`COALESCE(MIN(${generated_items.position}), 1) - 1` })
    .from(generated_items)
    .where(and(eq(generated_items.course_id, courseId), folderPredicate(generated_items.folder_id, folderId)));
  return next;
}

export async function createGeneratedItem(params: {
  courseId: number;
  folderId: number | null;
  sourceFolderId: number | null;
  sourceHandpicked: boolean;
  mode: GenerationMode;
  title: string;
  contentJson: unknown;
  sourceDocumentIds: number[];
  model?: { provider: AiBackend; model: string };
  studyPlanChapterId?: number | null;
}): Promise<GeneratedItem> {
  const now = nowUtc();
  // Same atomicity concern as createDocument — see its comment.
  const item = await runTransaction(async (tx) => {
    const [row] = await tx
      .insert(generated_items)
      .values({
        course_id: params.courseId,
        folder_id: params.folderId,
        position: await nextGeneratedItemPosition(params.courseId, params.folderId, tx),
        source_folder_id: params.sourceFolderId,
        source_handpicked: params.sourceHandpicked,
        mode: params.mode,
        title: params.title,
        content_json: JSON.stringify(params.contentJson),
        source_document_ids: JSON.stringify(params.sourceDocumentIds),
        model_provider: params.model?.provider ?? null,
        model_name: params.model?.model ?? null,
        study_plan_chapter_id: params.studyPlanChapterId ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning();
    return row;
  });
  return item as GeneratedItem;
}

// Documents within the item's actual generation scope, extracted, and not
// already reflected in source_document_ids — i.e. what a "supplement" pass
// would add. Three cases (NOT necessarily the folder the item is filed in —
// see schema.sql):
// - source_handpicked: a hand-picked "choose documents" selection has no
//   single coherent folder (it can span several), so there's nothing
//   sensible to check new uploads against — never offer to supplement these.
// - source_folder_id set: that one folder, pooled with every subfolder
//   nested under it, at any depth — matching how buildCourseContext itself collects documents
//   for a folder-scoped generation (lib/context.ts), so a doc uploaded into
//   a subfolder counts as "new" exactly when it would have been included
//   had it existed at generation time.
// - neither: a genuinely pooled "all course material" generation — every
//   folder's new documents count.
export async function getNewDocumentsForItem(item: GeneratedItem): Promise<DocumentRow[]> {
  if (item.source_handpicked) return [];

  const covered = new Set(JSON.parse(item.source_document_ids) as number[]);

  let docs: DocumentRow[];
  if (item.source_folder_id == null) {
    docs = (await listDocumentsForCourse(item.course_id)).filter((d) => d.status === "extracted");
  } else {
    const folderIds = subtreeFolderIds(await listFoldersForCourse(item.course_id), item.source_folder_id);
    docs = (await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.course_id, item.course_id),
          inArray(documents.folder_id, folderIds),
          eq(documents.status, "extracted")
        )
      )
      .orderBy(asc(documents.created_at))) as DocumentRow[];
  }
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

// Lands at the front of the destination folder (or the course's top-level
// list, for folderId null — un-filing back onto the course page is always
// valid, nothing to check against) — same place a freshly generated item
// would land.
export async function moveGeneratedItem(id: number, folderId: number | null): Promise<void> {
  const item = await getGeneratedItem(id);
  if (!item) return;
  if (folderId != null) {
    const destination = await getFolder(folderId);
    if (!destination || destination.course_id !== item.course_id) {
      throw new InvalidDestinationFolderError();
    }
  }
  // Wrapped in a transaction for the same reason as moveDocument — see its
  // comment.
  await runTransaction(async (tx) => {
    await tx
      .update(generated_items)
      .set({ folder_id: folderId, position: await nextGeneratedItemPosition(item.course_id, folderId, tx) })
      .where(eq(generated_items.id, id));
  });
}

// Applies a new drag-and-drop order in one transaction, same pattern as
// reorderDocuments/reorderFolders.
export async function reorderGeneratedItems(
  courseId: number,
  folderId: number | null,
  orderedIds: number[]
): Promise<void> {
  if (orderedIds.length === 0) return;
  await db
    .update(generated_items)
    .set({ position: positionCases(generated_items.id, orderedIds) })
    .where(
      and(
        eq(generated_items.course_id, courseId),
        folderPredicate(generated_items.folder_id, folderId),
        inArray(generated_items.id, orderedIds)
      )
    );
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

export type GeneratedItemSummary = Omit<GeneratedItem, "content_json">;

// For the course page's item list — content_json (the full generated
// quiz/notes/flashcard payload) isn't needed to render a title/mode/date
// row, only once a specific item is actually opened (getGeneratedItem
// above, already fetched narrowly on demand by the item page). Sibling of
// listDocumentSummariesForCourse for the same reason — see its comment.
export async function listGeneratedItemSummariesForCourse(
  courseId: number
): Promise<GeneratedItemSummary[]> {
  return db
    .select({
      id: generated_items.id,
      course_id: generated_items.course_id,
      folder_id: generated_items.folder_id,
      position: generated_items.position,
      mode: generated_items.mode,
      title: generated_items.title,
      source_document_ids: generated_items.source_document_ids,
      source_folder_id: generated_items.source_folder_id,
      source_handpicked: generated_items.source_handpicked,
      model_provider: generated_items.model_provider,
      model_name: generated_items.model_name,
      study_plan_chapter_id: generated_items.study_plan_chapter_id,
      created_at: generated_items.created_at,
      updated_at: generated_items.updated_at,
    })
    .from(generated_items)
    .where(eq(generated_items.course_id, courseId))
    .orderBy(asc(generated_items.position), desc(generated_items.created_at)) as Promise<
    GeneratedItemSummary[]
  >;
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

// Used to roll back an attempt row when grading fails after it's created —
// see the attempt route's own comment. Without this, a rate-limited or
// otherwise-failed grading call left a permanent attempt with no score/
// completed_at in "Previous attempts", since neither listQuizAttemptsForItem
// nor listRecentQuizAttemptsForItem filters on completed_at.
export async function deleteQuizAttempt(id: number): Promise<void> {
  await db.delete(quiz_attempts).where(eq(quiz_attempts.id, id));
}

export async function listQuizAttemptsForItem(generatedItemId: number): Promise<QuizAttempt[]> {
  return db
    .select()
    .from(quiz_attempts)
    .where(eq(quiz_attempts.generated_item_id, generatedItemId))
    .orderBy(desc(quiz_attempts.started_at));
}

const RECENT_QUIZ_ATTEMPTS_LIMIT = 20;

// Capped variant for the item detail page's "Previous attempts" list.
// listQuizAttemptsForItem (unbounded) is kept as-is for the data export
// route, which needs full fidelity. The item detail page's "best score"
// is deliberately NOT derived from this capped list — see
// getBestQuizScoreForItem — since the true best could be older than the
// most recent RECENT_QUIZ_ATTEMPTS_LIMIT attempts.
export async function listRecentQuizAttemptsForItem(generatedItemId: number): Promise<QuizAttempt[]> {
  return db
    .select()
    .from(quiz_attempts)
    .where(eq(quiz_attempts.generated_item_id, generatedItemId))
    .orderBy(desc(quiz_attempts.started_at))
    .limit(RECENT_QUIZ_ATTEMPTS_LIMIT);
}

export async function getBestQuizScoreForItem(generatedItemId: number): Promise<number | null> {
  const rows = await db
    .select({ best: max(quiz_attempts.score) })
    .from(quiz_attempts)
    .where(eq(quiz_attempts.generated_item_id, generatedItemId));
  return rows[0]?.best ?? null;
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

// review_items are keyed by positional card_index (see
// reconcileReviewItemsAfterRemoval in lib/review/store.ts); this does the
// same for the append-only flashcard_reviews log — nothing currently reads this log by index (see
// items/[itemId]/route.ts's GET, which drops it entirely), but leaving it
// unreconciled would mean any future feature that does (a per-card review
// history view, say) silently reads a stale card's history under a
// different card's current index. Unlike review_items, there's no
// (generated_item_id, card_index) uniqueness here — multiple review rows
// legitimately share a card_index over time — so this shifts each
// surviving row's index in place instead of delete-and-reinsert.
export async function reconcileFlashcardReviewsAfterRemoval(
  generatedItemId: number,
  removedIndices: number[]
): Promise<void> {
  if (removedIndices.length === 0) return;
  const removed = [...new Set(removedIndices)].sort((a, b) => a - b);

  const rows = await db
    .select()
    .from(flashcard_reviews)
    .where(eq(flashcard_reviews.generated_item_id, generatedItemId));
  if (rows.length === 0) return;

  await runTransaction(async (tx) => {
    for (const row of rows) {
      if (removed.includes(row.card_index)) {
        // This card itself was removed — its review history no longer
        // corresponds to any real card.
        await tx.delete(flashcard_reviews).where(eq(flashcard_reviews.id, row.id));
        continue;
      }
      const shift = removed.filter((i) => i < row.card_index).length;
      if (shift > 0) {
        await tx
          .update(flashcard_reviews)
          .set({ card_index: row.card_index - shift })
          .where(eq(flashcard_reviews.id, row.id));
      }
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

export interface CanvasSearchResult {
  kind: "canvas";
  canvasId: number;
  canvasTitle: string;
  courseId: number;
  courseName: string;
  snippets: string[];
}

export type SearchResult = ItemSearchResult | DocumentSearchResult | NoteSearchResult | CanvasSearchResult;

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
  // A single corrupted/truncated content_json row must not take out search
  // entirely — /api/search has no try/catch around loadSearchCorpus, so an
  // uncaught throw here previously 500'd every search, not just this item.
  let content: unknown;
  try {
    content = JSON.parse(contentJson);
  } catch (err) {
    console.error(`Skipping item ${key} with unparseable content_json in search:`, err);
    return [];
  }
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

// A canvas is searchable by everything written ON it — its title, its
// text cards (line by line, like a note), group names, and arrow labels.
// Note/document cards aren't expanded here: those notes and documents are
// already search results of their own.
export function canvasCandidates(title: string, data: CanvasData, key: string): SearchCandidate[] {
  const candidates: SearchCandidate[] = [{ key, text: title }];
  for (const node of data.nodes) {
    if (node.type === "text") candidates.push(...noteCandidates(node.text, key));
    else if (node.type === "group" && node.label) candidates.push({ key, text: node.label });
  }
  for (const edge of data.edges) {
    if (edge.label) candidates.push({ key, text: edge.label });
  }
  return candidates;
}

interface SearchCorpus {
  candidates: SearchCandidate[];
  metaByKey: Map<string, SearchResult>;
}

// The search box is debounced (see SearchDialog.tsx) but still fires once
// per pause in typing, and each call previously re-pulled every item's
// content_json plus every document's and note's full text from the DB —
// on a slow typist, a single query could trigger several full-library
// re-fetches in a row. Caching the assembled corpus for a few seconds per
// (course scope) means consecutive keystrokes in one search session reuse
// it instead of re-fetching. A short TTL (rather than write-path
// invalidation, which would mean touching every create/update/delete for
// items/documents/notes) is an acceptable tradeoff for a personal,
// single-user instance: a just-created item can take up to the TTL to
// become searchable.
const SEARCH_CORPUS_TTL_MS = 15_000;
const searchCorpusCache = new Map<string, { corpus: SearchCorpus; expiresAt: number }>();

async function loadSearchCorpus(courseId?: number): Promise<SearchCorpus> {
  const cacheKey = courseId ?? "all";
  const cached = searchCorpusCache.get(String(cacheKey));
  if (cached && cached.expiresAt > Date.now()) {
    return cached.corpus;
  }

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

  const canvasesBase = db
    .select({
      id: canvases.id,
      course_id: canvases.course_id,
      title: canvases.title,
      data: canvases.data,
      course_name: courses.name,
    })
    .from(canvases)
    .innerJoin(courses, eq(courses.id, canvases.course_id));

  const [itemRows, documentRows, noteRows, canvasRows] = await Promise.all([
    courseId ? itemsBase.where(eq(generated_items.course_id, courseId)) : itemsBase,
    courseId ? documentsBase.where(eq(documents.course_id, courseId)) : documentsBase,
    courseId ? notesBase.where(eq(notes.course_id, courseId)) : notesBase,
    courseId ? canvasesBase.where(eq(canvases.course_id, courseId)) : canvasesBase,
  ]);

  const candidates: SearchCandidate[] = [];
  const metaByKey = new Map<string, SearchResult>();

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

  for (const canvas of canvasRows) {
    const key = `canvas:${canvas.id}`;
    candidates.push(...canvasCandidates(canvas.title, parseCanvasJson(canvas.data), key));
    metaByKey.set(key, {
      kind: "canvas",
      canvasId: canvas.id,
      canvasTitle: canvas.title,
      courseId: canvas.course_id,
      courseName: canvas.course_name,
      snippets: [],
    });
  }

  const corpus: SearchCorpus = { candidates, metaByKey };
  searchCorpusCache.set(String(cacheKey), { corpus, expiresAt: Date.now() + SEARCH_CORPUS_TTL_MS });
  return corpus;
}

export async function searchAll(query: string, courseId?: number): Promise<SearchResult[]> {
  const { candidates, metaByKey } = await loadSearchCorpus(courseId);

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

// One year back, in the same "YYYY-MM-DD HH:MM:SS" format as every other
// timestamp column (see lib/time.ts's nowUtc) — both consumers below
// (streak.ts's computeStreak and StudyHeatmap, which shows up to 52 weeks,
// see lib/heatmapFit.ts) never look further back, so a full unbounded history scan of
// quiz_attempts/flashcard_reviews (which only ever grows) is wasted egress.
function oneYearAgoUtc(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export interface StudyActivity {
  dates: string[];
  counts: Record<string, number>;
}

// Combines what were previously two separate functions (listStudyDates,
// listStudyActivityCounts) issuing the exact same two queries — one pass
// over quiz_attempts/flashcard_reviews now feeds both the streak counter's
// date set and the activity heatmap's per-day counts.
export async function listStudyActivity(): Promise<StudyActivity> {
  const cutoff = oneYearAgoUtc();
  const [quizRows, reviewRows, questionRows] = await Promise.all([
    db
      .select({ completed_at: quiz_attempts.completed_at })
      .from(quiz_attempts)
      .where(and(isNotNull(quiz_attempts.completed_at), gte(quiz_attempts.completed_at, cutoff))),
    db
      .select({ reviewed_at: flashcard_reviews.reviewed_at })
      .from(flashcard_reviews)
      .where(gte(flashcard_reviews.reviewed_at, cutoff)),
    // Quiz questions answered one at a time in the review session. (Cards
    // reviewed there are already in flashcard_reviews, and questions from a
    // quiz attempt are counted by the attempt.)
    db
      .select({ reviewed_at: review_logs.reviewed_at })
      .from(review_logs)
      .innerJoin(review_items, eq(review_items.id, review_logs.review_item_id))
      .where(
        and(eq(review_logs.source, "queue"), eq(review_items.kind, "question"), gte(review_logs.reviewed_at, cutoff))
      ),
  ]);
  const dates = new Set<string>();
  const counts: Record<string, number> = {};
  for (const row of quizRows) {
    if (!row.completed_at) continue;
    const day = row.completed_at.slice(0, 10);
    dates.add(day);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  for (const row of [...reviewRows, ...questionRows]) {
    const day = row.reviewed_at.slice(0, 10);
    dates.add(day);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return { dates: [...dates], counts };
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
// deckDueCardIndices the same way the single-item route does.
export async function listDueFlashcardItems(): Promise<DueFlashcardItem[]> {
  const [rows, schedule] = await Promise.all([
    db
      .select()
      .from(generated_items)
      .innerJoin(courses, eq(courses.id, generated_items.course_id))
      .where(eq(generated_items.mode, "flashcards")),
    // Every reviewed card, not just the ones already due: a card with no
    // row counts as never reviewed and therefore due, so dropping the
    // not-yet-due rows here would make every card reviewed ahead of time
    // look due again.
    ensureFsrsMigrated().then(listAllCardDueRows),
  ]);

  const scheduleByItem = new Map<number, { card_index: number; due_at: string }[]>();
  for (const row of schedule) {
    const list = scheduleByItem.get(row.generated_item_id) ?? [];
    list.push(row);
    scheduleByItem.set(row.generated_item_id, list);
  }

  const due: DueFlashcardItem[] = [];
  for (const row of rows) {
    const item = row.generated_items;
    // A single corrupted/truncated content_json row must not take out the
    // whole dashboard — this is on /api/stats's hot path (every home page
    // load). Skipped rather than thrown: the rest of the deck is still
    // meaningful without this one item's due count.
    let content: FlashcardsContent;
    try {
      content = JSON.parse(item.content_json) as FlashcardsContent;
    } catch (err) {
      console.error(`Skipping flashcard item ${item.id} with unparseable content_json:`, err);
      continue;
    }
    const dueCount = deckDueCardIndices(scheduleByItem.get(item.id) ?? [], content).length;
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

// --- AI chat assistant ---
// A general-purpose chatbot independent of any course/document — see
// components/ChatDialog.tsx and lib/chat.ts (which builds the actual model
// call from a conversation's messages).

export type ChatRole = "user" | "assistant";

// Chat-only attachments — NOT filed into a course's document library (a
// separate "Save to course" action does that later, reusing the real
// course-upload pipeline). Documents keep their full original bytes
// (fileBase64), not just extractedText, precisely so that action has
// something to file. Images reuse the same data-URL convention as every
// other image field in this app (see dataUrlImage.ts).
export type ChatAttachment =
  | { type: "image"; filename: string; mimeType: string; dataUrl: string }
  | { type: "document"; filename: string; mimeType: string; fileBase64: string; extractedText: string };

// A folder/save action the AI proposed via chat (see chatActions.ts) — kept
// here rather than in chatActions.ts, which already imports several
// functions from this file, to avoid a circular import.
export type ChatAction =
  | { action: "createFolder"; folderName: string }
  | { action: "saveAttachment"; ref: string; folderId: number | null; newFolderName: string | null };

export interface PendingChatAction {
  id: string;
  actions: ChatAction[];
  status: "pending" | "confirmed_executing" | "executed" | "failed" | "cancelled";
  resultSummary: string | null;
}

export interface ChatConversation {
  id: number;
  title: string | null;
  // Optional course this conversation is scoped to — see sendChatMessage in
  // chat.ts for how this feeds course context into the model (either via a
  // trusted-CLI workspace/manifest, or folded-in text). null = standalone,
  // same as every conversation before this existed.
  courseId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: ChatRole;
  content: string;
  attachments: ChatAttachment[] | null;
  pendingAction: PendingChatAction | null;
  createdAt: string;
}

function toChatConversation(row: typeof chat_conversations.$inferSelect): ChatConversation {
  return {
    id: row.id,
    title: row.title,
    courseId: row.course_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseChatAttachments(raw: string | null): ChatAttachment[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatAttachment[]) : null;
  } catch {
    return null;
  }
}

function parsePendingChatAction(raw: string | null): PendingChatAction | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PendingChatAction) : null;
  } catch {
    return null;
  }
}

function toChatMessage(row: typeof chat_messages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    attachments: parseChatAttachments(row.attachments),
    pendingAction: parsePendingChatAction(row.pending_action),
    createdAt: row.created_at,
  };
}

export async function createChatConversation(): Promise<ChatConversation> {
  const now = nowUtc();
  const [row] = await db
    .insert(chat_conversations)
    .values({ created_at: now, updated_at: now })
    .returning();
  return toChatConversation(row);
}

// Newest-active-first — same ordering ChatGPT/Claude's own history list uses.
export async function listChatConversations(): Promise<ChatConversation[]> {
  const rows = await db.select().from(chat_conversations).orderBy(desc(chat_conversations.updated_at));
  return rows.map(toChatConversation);
}

export async function getChatConversation(
  id: number
): Promise<{ conversation: ChatConversation; messages: ChatMessage[] } | undefined> {
  const [row] = await db.select().from(chat_conversations).where(eq(chat_conversations.id, id)).limit(1);
  if (!row) return undefined;
  const messageRows = await db
    .select()
    .from(chat_messages)
    .where(eq(chat_messages.conversation_id, id))
    .orderBy(asc(chat_messages.id));
  return { conversation: toChatConversation(row), messages: messageRows.map(toChatMessage) };
}

export async function deleteChatConversation(id: number): Promise<void> {
  // chat_messages references this ON DELETE CASCADE — no separate cleanup.
  await db.delete(chat_conversations).where(eq(chat_conversations.id, id));
}

// Scopes (or unscopes, with courseId null) a conversation to one course —
// see ChatConversation.courseId's doc comment. Doesn't touch updated_at:
// picking a course isn't "activity" the way sending a message is, and
// bumping it would otherwise reorder the conversation list just from
// opening the picker.
export async function setChatConversationCourse(id: number, courseId: number | null): Promise<void> {
  await db.update(chat_conversations).set({ course_id: courseId }).where(eq(chat_conversations.id, id));
}

// Appends one message and bumps the conversation's updated_at (what
// listChatConversations sorts by) in the same call — every append is
// "activity" on the conversation, not just user ones. The very first user
// message also seeds the conversation's title (truncated — a short label
// for the history list, not the full first message), same as ChatGPT/
// Claude's own auto-titling; later messages never touch it.
export async function addChatMessage(
  conversationId: number,
  role: ChatRole,
  content: string,
  attachments?: ChatAttachment[],
  pendingAction?: PendingChatAction
): Promise<ChatMessage> {
  const now = nowUtc();
  const [message] = await db
    .insert(chat_messages)
    .values({
      conversation_id: conversationId,
      role,
      content,
      attachments: attachments?.length ? JSON.stringify(attachments) : null,
      pending_action: pendingAction ? JSON.stringify(pendingAction) : null,
      created_at: now,
    })
    .returning();

  const updates: { updated_at: string; title?: string } = { updated_at: now };
  if (role === "user") {
    const [existing] = await db
      .select({ title: chat_conversations.title })
      .from(chat_conversations)
      .where(eq(chat_conversations.id, conversationId))
      .limit(1);
    if (existing && existing.title === null) {
      const trimmed = content.trim().slice(0, 60);
      updates.title = trimmed.length < content.trim().length ? `${trimmed}…` : trimmed;
    }
  }
  await db.update(chat_conversations).set(updates).where(eq(chat_conversations.id, conversationId));

  return toChatMessage(message);
}

// Used to roll back the user's just-persisted message when the model call
// that was supposed to follow it fails — see chat.ts's sendChatMessage.
// Without this, a failed send left the user's message permanently in the
// conversation with no reply after it, even though the client had already
// rolled back its own optimistic copy — reloading the conversation would
// bring it back, duplicated, the next time the same text was sent.
export async function deleteChatMessage(id: number): Promise<void> {
  await db.delete(chat_messages).where(eq(chat_messages.id, id));
}

export async function getChatMessage(id: number): Promise<ChatMessage | undefined> {
  const rows = await db.select().from(chat_messages).where(eq(chat_messages.id, id)).limit(1);
  return rows[0] ? toChatMessage(rows[0]) : undefined;
}

// Updates only the pendingAction field — used to move a proposed action
// through pending -> confirmed_executing -> executed/failed, or -> cancelled
// (see chat.ts's resolvePendingAction). Never touches content/attachments.
export async function updateChatMessagePendingAction(
  id: number,
  pendingAction: PendingChatAction
): Promise<void> {
  await db
    .update(chat_messages)
    .set({ pending_action: JSON.stringify(pendingAction) })
    .where(eq(chat_messages.id, id));
}

// --- Quiz generation presets ---
// Named, reusable QuizGenerationSettings (see lib/types.ts and
// components/QuizGenerationDialog.tsx) — "only text answers", "only
// multiple choice", etc.

export interface QuizPreset {
  id: number;
  name: string;
  settings: QuizGenerationSettings;
  createdAt: string;
}

function toQuizPreset(row: typeof quiz_generation_presets.$inferSelect): QuizPreset {
  return {
    id: row.id,
    name: row.name,
    settings: {
      singleChoice: row.single_choice,
      multipleChoice: row.multiple_choice,
      shortAnswer: row.short_answer,
    },
    createdAt: row.created_at,
  };
}

export async function listQuizPresets(): Promise<QuizPreset[]> {
  const rows = await db.select().from(quiz_generation_presets).orderBy(asc(quiz_generation_presets.id));
  return rows.map(toQuizPreset);
}

export async function createQuizPreset(name: string, settings: QuizGenerationSettings): Promise<QuizPreset> {
  const [row] = await db
    .insert(quiz_generation_presets)
    .values({
      name,
      single_choice: settings.singleChoice,
      multiple_choice: settings.multipleChoice,
      short_answer: settings.shortAnswer,
      created_at: nowUtc(),
    })
    .returning();
  return toQuizPreset(row);
}

export async function deleteQuizPreset(id: number): Promise<void> {
  await db.delete(quiz_generation_presets).where(eq(quiz_generation_presets.id, id));
}
