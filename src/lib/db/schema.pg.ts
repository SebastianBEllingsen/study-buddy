import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  DocumentStatus,
  GenerationMode,
  FlashcardResult,
  AiBackend,
  ChatRole,
} from "../models";
import type {
  ChapterLevel,
  LinkStatus,
  ResourceKind,
  ResourceOrigin,
  StudyPlanPreset,
  SessionKind,
  StudyPlanStatus,
} from "../studyPlan/types";
import type { Confidence, ReviewItemKind, ReviewSource } from "../review/types";
import type { AttemptStatus } from "../exams/types";
import type { ExplainKind, ExplainStatus } from "../explain/types";
import type { ProblemSetKind } from "../problems/types";
import type { SourceTrust } from "../sources/types";
import type { CodeLanguage } from "../code/types";

// Postgres-flavored mirror of schema.sqlite.ts — same logical shape, same
// snake_case field names (so rows are shaped exactly like this app's
// existing row types), but serial/identity PKs and a native boolean column
// instead of SQLite's integer-as-boolean. Timestamp columns stay plain TEXT
// here too (not Postgres's native timestamp type) — every timestamp in this
// app is an app-generated "YYYY-MM-DD HH:MM:SS" UTC string (see lib/time.ts)
// compared with plain string ops (computeDueCardIndices, computeStreak), and
// keeping that identical on both backends means that logic needs no
// per-dialect branching.
//
// Unlike the SQLite schema, table creation here IS owned by Drizzle: a new
// Supabase project has no pre-existing data or historical migration
// baggage, so Drizzle Kit-generated migrations (see drizzle/pg/) can create
// this shape directly. See db/postgres.ts.

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  // Course customization — see schema.sqlite.ts for the matching columns.
  // `icon` is a single emoji character. `color` is a hex string used as the
  // course's accent (card border, header) when no icon_image is set.
  // `cover_image` is a data URL (e.g. "data:image/png;base64,...") for a
  // Notion-style banner — stored inline like documents.file_base64 rather
  // than on disk, since it's small and needs no PDF-style local-file fast
  // path. `icon_image` is a separate data URL for the small square badge
  // (home page course card, course header) — kept apart from cover_image
  // because the two need different crops (square vs. wide banner) from
  // what may be the same source photo. Badge display priority is
  // icon_image > icon (emoji) > a default icon.
  icon: text("icon"),
  color: text("color"),
  cover_image: text("cover_image"),
  icon_image: text("icon_image"),
  // When true and cover_image is set, the home page's course card uses the
  // cover image as its own background (with a dark overlay for legibility)
  // instead of the plain card surface — opt-in since a busy photo can hurt
  // scanability in the compact list view.
  show_cover_on_card: boolean("show_cover_on_card").notNull().default(false),
  // When false, icon_image renders as a bare "sticker" with no bordered/
  // tinted container around it — lets a transparent-background badge sit
  // directly on the course's own background instead of inside a box.
  // Defaults true so existing courses keep today's boxed look unchanged.
  show_icon_frame: boolean("show_icon_frame").notNull().default(true),
  // False hides the course page's Practice card, for courses that aren't
  // studied with quizzes/flashcards. Defaults true (today's behavior).
  show_practice: boolean("show_practice").notNull().default(true),
  // The course-page counterpart of app_settings.dashboard_lock_background_crop:
  // true draws page_background_image at exactly the aspect ratio it was
  // cropped to, instead of a fixed-height banner that reframes on resize.
  lock_background_crop: boolean("lock_background_crop").notNull().default(false),
  // This course's own choice of folder count tags, as JSON — see
  // lib/folderChips.ts. Null follows app_settings.folder_chips.
  folder_chips: text("folder_chips"),
  // A big, Steam-library-style backdrop behind the whole course page — a
  // separate field from cover_image because a good banner crop (wide,
  // short) and a good full-page background crop (tall, atmospheric) are
  // rarely the same crop of the same photo.
  page_background_image: text("page_background_image"),
  created_at: text("created_at").notNull(),
});

export const app_settings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  ai_provider: text("ai_provider").notNull().default("api").$type<AiBackend>(),
  // NULL means "use ai_provider" — see the same column in schema.sql.
  image_ai_provider: text("image_ai_provider").$type<AiBackend>(),
  anthropic_api_key: text("anthropic_api_key"),
  openai_api_key: text("openai_api_key"),
  gemini_api_key: text("gemini_api_key"),
  openrouter_api_key: text("openrouter_api_key"),
  show_model_badge: boolean("show_model_badge").notNull().default(true),
  // Google Calendar integration (see lib/googleCalendar.ts) — the OAuth
  // client itself is user-supplied (their own Google Cloud project, same
  // "bring your own key" convention as the AI provider keys above), and the
  // tokens are whatever that client's consent flow produced for this user.
  // google_token_expiry is a Unix ms timestamp (as text, matching this
  // table's other free-form fields) — the googleapis client's own
  // OAuth2Client.credentials.expiry_date shape, not this app's usual
  // "YYYY-MM-DD HH:MM:SS" nowUtc() format.
  google_client_id: text("google_client_id"),
  google_client_secret: text("google_client_secret"),
  google_access_token: text("google_access_token"),
  google_refresh_token: text("google_refresh_token"),
  google_token_expiry: text("google_token_expiry"),
  // JSON-encoded HomeWidgetConfig[] (see lib/models.ts) — null means "use
  // the default order/visibility", same convention as show_model_badge's
  // fallback but stored as JSON since it's an ordered list, not a scalar.
  home_widgets: text("home_widgets"),
  // See generation_notifications below — off means a finished generation is
  // recorded there instead of navigating straight to it.
  auto_open_generated_items: boolean("auto_open_generated_items").notNull().default(true),
  // App-wide rebrand — a custom name/icon (emoji and/or an uploaded image,
  // same icon/icon_image split as course customization above) and a font
  // pick independent of the appearance theme (data-app-theme), so "which
  // theme" and "which font" are two separate axes rather than the font
  // being baked into the theme choice. All null = the built-in defaults.
  app_name: text("app_name"),
  app_icon: text("app_icon"),
  app_icon_image: text("app_icon_image"),
  app_font: text("app_font"),
  dashboard_background_image: text("dashboard_background_image"),
  // "overlap" | "backdrop" | null (null == "overlap") — see the matching
  // column/comment in schema.sqlite.ts and the AppSettings.dashboardBannerStyle
  // doc comment in models.ts.
  dashboard_banner_style: text("dashboard_banner_style"),
  // See AppSettings.aiGradingEnabled's doc comment in models.ts.
  ai_grading_enabled: boolean("ai_grading_enabled").notNull().default(false),
  // See AppSettings.dashboardTransparentWidgets's doc comment in models.ts.
  dashboard_transparent_widgets: boolean("dashboard_transparent_widgets").notNull().default(false),
  // See AppSettings.dashboardLockBackgroundCrop's doc comment in models.ts.
  dashboard_lock_background_crop: boolean("dashboard_lock_background_crop").notNull().default(false),
  // See AppSettings.dashboardBackdropFullPage's doc comment in models.ts.
  dashboard_backdrop_full_page: boolean("dashboard_backdrop_full_page").notNull().default(false),
  // See AppSettings.unlimitedUploads's doc comment in models.ts.
  unlimited_uploads: boolean("unlimited_uploads").notNull().default(false),
  // See AppSettings.documentBadgesEnabled's doc comment in models.ts.
  document_badges_enabled: boolean("document_badges_enabled").notNull().default(true),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.sqlite.ts and the AppSettings.documentBadgeDetail
  // doc comment in models.ts.
  document_badge_detail: text("document_badge_detail"),
  // Which folder count tags course pages show, as JSON — see
  // lib/folderChips.ts. Null == all of them.
  folder_chips: text("folder_chips"),
  // The dashboard backdrop as a wallpaper behind other pages, as JSON — see
  // lib/appWallpaper.ts. Null == off, with the default areas/dim/blur.
  app_wallpaper: text("app_wallpaper"),
  // How the nav bar is colored over backdrops — see lib/headerTint.ts.
  // Null == "static".
  header_tint: text("header_tint"),
  // The dashboard Links widget's links, as JSON — see lib/dashboardLinks.ts.
  dashboard_links: text("dashboard_links"),
  // Hide every course's own backdrop/cover banner, and/or its icon, on
  // course pages — see lib/coursePageDisplay.ts.
  hide_course_backdrops: boolean("hide_course_backdrops").notNull().default(false),
  hide_course_icons: boolean("hide_course_icons").notNull().default(false),
  // Blur on the dashboard backdrop, in px — see lib/backdropBlur.ts.
  dashboard_backdrop_blur: integer("dashboard_backdrop_blur").notNull().default(0),
  // See AppSettings.aiEfficiencyMode's doc comment in models.ts.
  ai_efficiency_mode: boolean("ai_efficiency_mode").notNull().default(false),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.sqlite.ts and the AppSettings.modelBadgeDetail
  // doc comment in models.ts.
  model_badge_detail: text("model_badge_detail"),
  // See AppSettings.aiEnabled's doc comment in models.ts.
  ai_enabled: boolean("ai_enabled").notNull().default(true),
  // See AppSettings.cliTrustedModeEnabled's doc comment in models.ts — relaxes
  // the claude_code/codex_cli backends' sandboxing (Bash/file/network tools,
  // confined to a dedicated workspace dir) when true.
  cli_trusted_mode_enabled: boolean("cli_trusted_mode_enabled").notNull().default(false),
  // See the matching column in schema.sqlite.ts and lib/languages.ts.
  preferred_language: text("preferred_language"),
  // See the matching columns in schema.sqlite.ts.
  review_retention: real("review_retention"),
  new_cards_per_day: integer("new_cards_per_day"),
  fsrs_migrated_at: text("fsrs_migrated_at"),
  updated_at: text("updated_at").notNull(),
});

export const folders = pgTable(
  "folders",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    // See schema.sqlite.ts — same any-depth nesting and cascade backstop.
    parent_folder_id: integer("parent_folder_id").references((): AnyPgColumn => folders.id, {
      onDelete: "cascade",
    }),
    icon: text("icon"),
    color: text("color"),
    created_at: text("created_at").notNull(),
  },
  // Mirrors schema.sql's idx_folders_course_id — SQLite's equivalent of
  // every index below. Postgres, unlike SQLite here, has table creation
  // owned by Drizzle Kit, so these just need to be declared once.
  (table) => [index("idx_folders_course_id").on(table.course_id)]
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    folder_id: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
    // Manual drag-reorder within a folder — see reorderDocuments in models.ts.
    // Scoped per folder like folders.position is scoped per course, not
    // globally unique.
    position: integer("position").notNull().default(0),
    filename: text("filename").notNull(),
    file_path: text("file_path").notNull(),
    // See schema.sqlite.ts — base64-encoded original PDF bytes, synced
    // alongside the row so the file travels with it, not just its metadata.
    file_base64: text("file_base64"),
    extracted_text: text("extracted_text"),
    page_count: integer("page_count"),
    char_count: integer("char_count"),
    status: text("status").notNull().default("pending").$type<DocumentStatus>(),
    error_message: text("error_message"),
    // "official" (course material) or "personal" (the student's own notes) —
  // see the matching comment in schema.sql.
  trust: text("trust").notNull().default("official").$type<SourceTrust>(),
  created_at: text("created_at").notNull(),
  },
  (table) => [
    index("idx_documents_course_id").on(table.course_id),
    index("idx_documents_folder_id").on(table.folder_id),
  ]
);

export const generated_items = pgTable(
  "generated_items",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    folder_id: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
    // Manual drag-reorder within a folder — see reorderGeneratedItems in models.ts.
    position: integer("position").notNull().default(0),
    mode: text("mode").notNull().$type<GenerationMode>(),
    title: text("title").notNull(),
    content_json: text("content_json").notNull(),
    source_document_ids: text("source_document_ids").notNull(),
    source_folder_id: integer("source_folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    // True for a hand-picked "choose documents" selection — also leaves
    // source_folder_id null (not scoped to one folder) but is distinct from a
    // pooled "all course material" generation. See schema.sql and
    // getNewDocumentsForItem in models.ts.
    source_handpicked: boolean("source_handpicked").notNull().default(false),
    model_provider: text("model_provider").$type<AiBackend>(),
    model_name: text("model_name"),
    // See the matching column in schema.sqlite.ts.
    study_plan_chapter_id: integer("study_plan_chapter_id").references((): AnyPgColumn => study_plan_chapters.id, {
      onDelete: "set null",
    }),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_generated_items_course_id").on(table.course_id),
    index("idx_generated_items_study_plan_chapter_id").on(table.study_plan_chapter_id),
    // Neither of these is indexed on the SQLite side either — added on both
    // backends together, since it's the same class of gap as
    // idx_documents_folder_id above and these columns are hit by the same
    // per-folder listing/backfill queries in models.ts.
    index("idx_generated_items_folder_id").on(table.folder_id),
    index("idx_generated_items_source_folder_id").on(table.source_folder_id),
  ]
);

export const quiz_attempts = pgTable(
  "quiz_attempts",
  {
    id: serial("id").primaryKey(),
    generated_item_id: integer("generated_item_id")
      .notNull()
      .references(() => generated_items.id, { onDelete: "cascade" }),
    started_at: text("started_at").notNull(),
    completed_at: text("completed_at"),
    score: real("score"),
    answers_json: text("answers_json"),
  },
  (table) => [index("idx_quiz_attempts_item_id").on(table.generated_item_id)]
);

export const flashcard_reviews = pgTable(
  "flashcard_reviews",
  {
    id: serial("id").primaryKey(),
    generated_item_id: integer("generated_item_id")
      .notNull()
      .references(() => generated_items.id, { onDelete: "cascade" }),
    card_index: integer("card_index").notNull(),
    last_result: text("last_result").notNull().$type<FlashcardResult>(),
    reviewed_at: text("reviewed_at").notNull(),
  },
  (table) => [index("idx_flashcard_reviews_item_id").on(table.generated_item_id)]
);

export const flashcard_schedule = pgTable(
  "flashcard_schedule",
  {
    generated_item_id: integer("generated_item_id")
      .notNull()
      .references(() => generated_items.id, { onDelete: "cascade" }),
    card_index: integer("card_index").notNull(),
    ease_factor: real("ease_factor").notNull().default(2.5),
    interval_days: real("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    due_at: text("due_at").notNull(),
    last_reviewed_at: text("last_reviewed_at"),
  },
  (table) => [primaryKey({ columns: [table.generated_item_id, table.card_index] })]
);

// One row per finished generation still awaiting acknowledgement — see the
// matching comment in schema.sql.
export const generation_notifications = pgTable("generation_notifications", {
  generated_item_id: integer("generated_item_id")
    .primaryKey()
    .references(() => generated_items.id, { onDelete: "cascade" }),
  created_at: text("created_at").notNull(),
});

// Read-only external ICS calendar subscriptions — see the matching table in
// schema.sql (SQLite) and lib/calendarFeeds.ts for how these get fetched,
// parsed, and merged into the Google Calendar events list at read time.
export const calendar_feeds = pgTable("calendar_feeds", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  show_on_calendar: boolean("show_on_calendar").notNull().default(true),
  show_in_widget: boolean("show_in_widget").notNull().default(true),
  // Master switch — off means this feed isn't fetched at all (see
  // fetchAllFeedEvents' caller in api/calendar/events/route.ts), not just
  // hidden from one place the way show_on_calendar/show_in_widget are.
  // Pausing a feed like this keeps its URL/label around, unlike deleting it.
  enabled: boolean("enabled").notNull().default(true),
  // Own /calendar tab + its JSON settings — see schema.sql's comment.
  own_calendar: boolean("own_calendar").notNull().default(false),
  calendar_config: text("calendar_config"),
  created_at: text("created_at").notNull(),
});

// The Vault: personal Obsidian-style notes — see the matching comment in
// schema.sql. Title uniqueness is enforced case-insensitively in
// models.ts, not here (see schema.sql's comment on the same table).
export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    // Nullable — see the matching comment in schema.sql for why (ALTER'd
    // onto this table after it shipped; application code always populates
    // both).
    course_id: integer("course_id").references(() => courses.id, { onDelete: "cascade" }),
    folder_id: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    markdown: text("markdown").notNull().default(""),
    icon: text("icon"),
    // Null: not used for generation; otherwise included with that trust.
  generation_source: text("generation_source").$type<SourceTrust>(),
  created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_notes_course_id").on(table.course_id),
    index("idx_notes_folder_id").on(table.folder_id),
  ]
);

// Obsidian-style canvases — see the matching comment in schema.sql.
export const canvases = pgTable(
  "canvases",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    data: text("data").notNull().default('{"nodes":[],"edges":[]}'),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [index("idx_canvases_course_id").on(table.course_id)]
);

// Checked-off state for the Assignments widget's checklist — see the
// matching comment in schema.sql for why this keys by the feed event's own
// id rather than a foreign key.
export const completed_assignments = pgTable("completed_assignments", {
  event_id: text("event_id").primaryKey(),
  completed_at: text("completed_at").notNull(),
});

// "Last opened" state for the Recent activity widget — see the matching
// comment in schema.sql.
export const recent_views = pgTable(
  "recent_views",
  {
    item_type: text("item_type").notNull(),
    item_id: integer("item_id").notNull(),
    viewed_at: text("viewed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.item_type, table.item_id] })]
);

// Reusable icon/cover image library — see the matching comment in
// schema.sql.
export const uploaded_images = pgTable(
  "uploaded_images",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    data_url: text("data_url").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_uploaded_images_kind").on(table.kind)]
);

// General-purpose AI chat assistant — see the matching comment in schema.sql.
export const chat_conversations = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  title: text("title"),
  // Optional course this conversation is scoped to — see
  // ChatConversation.courseId's doc comment in models.ts. NULL = standalone.
  course_id: integer("course_id").references(() => courses.id, { onDelete: "set null" }),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const chat_messages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversation_id: integer("conversation_id")
      .notNull()
      .references(() => chat_conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<ChatRole>(),
    content: text("content").notNull(),
    // JSON-encoded ChatAttachment[] (see models.ts) — NULL when the message
    // has no attachments.
    attachments: text("attachments"),
    // JSON-encoded PendingChatAction (see chatActions.ts / models.ts) — NULL
    // unless this assistant message proposed a folder/save action awaiting
    // (or having received) user confirmation.
    pending_action: text("pending_action"),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_chat_messages_conversation_id").on(table.conversation_id)]
);

// Saved quiz-generation configurations — see the matching comment in schema.sql.
export const quiz_generation_presets = pgTable("quiz_generation_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  single_choice: boolean("single_choice").notNull().default(true),
  multiple_choice: boolean("multiple_choice").notNull().default(false),
  short_answer: boolean("short_answer").notNull().default(true),
  created_at: text("created_at").notNull(),
});

// AI-built learning roadmap for a course — see the matching comment in
// schema.sql and lib/studyPlan/. One plan per course (unique course_id).
export const study_plans = pgTable("study_plans", {
  id: serial("id").primaryKey(),
  course_id: integer("course_id")
    .notNull()
    .unique()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().$type<StudyPlanStatus>(),
  preset: text("preset").notNull().$type<StudyPlanPreset>(),
  options_json: text("options_json").notNull(),
  syllabus_document_id: integer("syllabus_document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  syllabus_text: text("syllabus_text"),
  source_document_ids: text("source_document_ids").notNull(),
  source_folder_id: integer("source_folder_id").references(() => folders.id, { onDelete: "set null" }),
  source_handpicked: boolean("source_handpicked").notNull().default(false),
  language: text("language").notNull(),
  model_provider: text("model_provider").$type<AiBackend>(),
  model_name: text("model_name"),
  used_web_search: boolean("used_web_search").notNull().default(false),
  error_message: text("error_message"),
  links_checked_at: text("links_checked_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const study_plan_chapters = pgTable(
  "study_plan_chapters",
  {
    id: serial("id").primaryKey(),
    plan_id: integer("plan_id")
      .notNull()
      .references(() => study_plans.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    stage: integer("stage").notNull().default(1),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    subtopics_json: text("subtopics_json").notNull().default("[]"),
    prerequisite_ids_json: text("prerequisite_ids_json").notNull().default("[]"),
    linked_document_ids_json: text("linked_document_ids_json").notNull().default("[]"),
    current_level: text("current_level").$type<ChapterLevel>(),
    estimated_minutes: integer("estimated_minutes"),
    completed_at: text("completed_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [index("idx_study_plan_chapters_plan_id").on(table.plan_id)]
);

export const study_plan_resources = pgTable(
  "study_plan_resources",
  {
    id: serial("id").primaryKey(),
    chapter_id: integer("chapter_id")
      .notNull()
      .references(() => study_plan_chapters.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    kind: text("kind").notNull().$type<ResourceKind>(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    provider: text("provider"),
    language: text("language"),
    note: text("note").notNull().default(""),
    origin: text("origin").notNull().default("ai").$type<ResourceOrigin>(),
    link_status: text("link_status").notNull().default("unchecked").$type<LinkStatus>(),
    status_detail: text("status_detail"),
    checked_at: text("checked_at"),
    done_at: text("done_at"),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_study_plan_resources_chapter_id").on(table.chapter_id)]
);

// One dated study session of a plan's schedule — see lib/studyPlan/schedule.ts.
export const study_plan_sessions = pgTable(
  "study_plan_sessions",
  {
    id: serial("id").primaryKey(),
    plan_id: integer("plan_id")
      .notNull()
      .references(() => study_plans.id, { onDelete: "cascade" }),
    chapter_id: integer("chapter_id")
      .notNull()
      .references(() => study_plan_chapters.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    minutes: integer("minutes").notNull(),
    kind: text("kind").notNull().default("study").$type<SessionKind>(),
    done_at: text("done_at"),
    google_event_id: text("google_event_id"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    index("idx_study_plan_sessions_plan_id").on(table.plan_id),
    index("idx_study_plan_sessions_date").on(table.date),
  ]
);

// See the matching tables in schema.sqlite.ts.
export const concepts = pgTable(
  "concepts",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    chapter_id: integer("chapter_id").references(() => study_plan_chapters.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_concepts_course_id").on(table.course_id)]
);

export const review_items = pgTable(
  "review_items",
  {
    id: serial("id").primaryKey(),
    generated_item_id: integer("generated_item_id")
      .notNull()
      .references(() => generated_items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<ReviewItemKind>(),
    item_index: integer("item_index").notNull(),
    concept_id: integer("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    due_at: text("due_at").notNull(),
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    state: integer("state").notNull().default(0),
    scheduled_days: integer("scheduled_days").notNull().default(0),
    last_reviewed_at: text("last_reviewed_at"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_review_items_item_kind_index").on(table.generated_item_id, table.kind, table.item_index),
    index("idx_review_items_due_at").on(table.due_at),
  ]
);

export const review_logs = pgTable(
  "review_logs",
  {
    id: serial("id").primaryKey(),
    review_item_id: integer("review_item_id")
      .notNull()
      .references(() => review_items.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    confidence: text("confidence").$type<Confidence>(),
    source: text("source").notNull().$type<ReviewSource>(),
    correct: boolean("correct").notNull(),
    reviewed_at: text("reviewed_at").notNull(),
    stability: real("stability").notNull(),
    difficulty: real("difficulty").notNull(),
    scheduled_days: integer("scheduled_days").notNull(),
  },
  (table) => [
    index("idx_review_logs_review_item_id").on(table.review_item_id),
    index("idx_review_logs_reviewed_at").on(table.reviewed_at),
  ]
);

export const mistakes = pgTable(
  "mistakes",
  {
    id: serial("id").primaryKey(),
    generated_item_id: integer("generated_item_id")
      .notNull()
      .references(() => generated_items.id, { onDelete: "cascade" }),
    review_item_id: integer("review_item_id").references(() => review_items.id, { onDelete: "set null" }),
    concept_id: integer("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    kind: text("kind").notNull().$type<ReviewItemKind>(),
    item_index: integer("item_index").notNull(),
    prompt: text("prompt").notNull(),
    given_answer: text("given_answer"),
    correct_answer: text("correct_answer").notNull(),
    confidence: text("confidence").$type<Confidence>(),
    misconception: text("misconception"),
    created_at: text("created_at").notNull(),
    resolved_at: text("resolved_at"),
  },
  (table) => [index("idx_mistakes_generated_item_id").on(table.generated_item_id)]
);

// See the matching tables in schema.sqlite.ts.
export const exam_profiles = pgTable("exam_profiles", {
  id: serial("id").primaryKey(),
  course_id: integer("course_id")
    .notNull()
    .unique()
    .references(() => courses.id, { onDelete: "cascade" }),
  source_document_ids_json: text("source_document_ids_json").notNull().default("[]"),
  profile_json: text("profile_json").notNull(),
  model_provider: text("model_provider").$type<AiBackend>(),
  model_name: text("model_name"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// A generated mock exam (lib/exams/generate.ts). practice_item_id is the
// quiz its graded tasks are reviewed through afterwards.
export const mock_exams = pgTable(
  "mock_exams",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    duration_minutes: integer("duration_minutes").notNull(),
    total_points: real("total_points").notNull(),
    tasks_json: text("tasks_json").notNull(),
    practice_item_id: integer("practice_item_id").references(() => generated_items.id, { onDelete: "set null" }),
    model_provider: text("model_provider").$type<AiBackend>(),
    model_name: text("model_name"),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_mock_exams_course_id").on(table.course_id)]
);

// One sitting of a mock exam: answers as typed text and/or photos of
// handwritten work, then the step-by-step grading (lib/exams/grade.ts).
export const mock_exam_attempts = pgTable(
  "mock_exam_attempts",
  {
    id: serial("id").primaryKey(),
    mock_exam_id: integer("mock_exam_id")
      .notNull()
      .references(() => mock_exams.id, { onDelete: "cascade" }),
    status: text("status").notNull().$type<AttemptStatus>(),
    answers_json: text("answers_json").notNull().default("[]"),
    results_json: text("results_json"),
    score: real("score"),
    error_message: text("error_message"),
    started_at: text("started_at").notNull(),
    // Pausing stops the exam clock: paused_at is set while paused, and
    // paused_seconds adds up earlier pauses.
    paused_at: text("paused_at"),
    paused_seconds: integer("paused_seconds").notNull().default(0),
    submitted_at: text("submitted_at"),
  },
  (table) => [index("idx_mock_exam_attempts_exam_id").on(table.mock_exam_id)]
);

// A course's exam date (YYYY-MM-DD), for the readiness forecast and exam
// mode (lib/readiness/).
export const exam_dates = pgTable("exam_dates", {
  id: serial("id").primaryKey(),
  course_id: integer("course_id")
    .notNull()
    .unique()
    .references(() => courses.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  updated_at: text("updated_at").notNull(),
});

// Blurt and Feynman sessions (lib/explain/): explaining a topic from
// memory, then the gaps the AI found. practice_item_id is the flashcard
// deck the gaps were added to.
export const explain_sessions = pgTable(
  "explain_sessions",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    chapter_id: integer("chapter_id").references(() => study_plan_chapters.id, { onDelete: "set null" }),
    kind: text("kind").notNull().$type<ExplainKind>(),
    topic: text("topic").notNull(),
    status: text("status").notNull().$type<ExplainStatus>(),
    messages_json: text("messages_json").notNull().default("[]"),
    result_json: text("result_json"),
    practice_item_id: integer("practice_item_id").references(() => generated_items.id, { onDelete: "set null" }),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [index("idx_explain_sessions_course_id").on(table.course_id)]
);

// Problem-solving practice (lib/problems/): a coached set (a worked example,
// then a faded one, then problems to solve alone) or a mixed set across
// concepts. progress_json holds the learner's work; practice_item_id is the
// quiz its solved problems are reviewed through.
export const problem_sets = pgTable(
  "problem_sets",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    chapter_id: integer("chapter_id").references(() => study_plan_chapters.id, { onDelete: "set null" }),
    kind: text("kind").notNull().$type<ProblemSetKind>(),
    title: text("title").notNull(),
    content_json: text("content_json").notNull(),
    progress_json: text("progress_json").notNull().default("[]"),
    practice_item_id: integer("practice_item_id").references(() => generated_items.id, { onDelete: "set null" }),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [index("idx_problem_sets_course_id").on(table.course_id)]
);

// Source conflict checks — see the matching comment in schema.sql.
export const source_checks = pgTable(
  "source_checks",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    source_keys_json: text("source_keys_json").notNull().default("[]"),
    result_json: text("result_json").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_source_checks_course_id").on(table.course_id)]
);

// Code exercises — see the matching comment in schema.sql.
export const code_sets = pgTable(
  "code_sets",
  {
    id: serial("id").primaryKey(),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    chapter_id: integer("chapter_id").references(() => study_plan_chapters.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    language: text("language").notNull().$type<CodeLanguage>(),
    content_json: text("content_json").notNull(),
    progress_json: text("progress_json").notNull().default("[]"),
    practice_item_id: integer("practice_item_id").references(() => generated_items.id, { onDelete: "set null" }),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [index("idx_code_sets_course_id").on(table.course_id)]
);
