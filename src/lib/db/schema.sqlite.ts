import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
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

// Mirrors src/lib/schema.sql's tables. Field names are snake_case (matching
// the DB columns 1:1, not Drizzle's usual camelCase convention) so the rows
// Drizzle returns are shaped exactly like this app's existing snake_case
// row types (Course, Folder, GeneratedItem, ...) in models.ts — those types,
// and every API response built from them, don't change shape.
//
// Table creation/migration for SQLite is NOT owned by Drizzle — it's still
// schema.sql + the ad-hoc migrate() in db/sqlite.ts, preserved as-is so
// existing local databases upgrade exactly like before. This file only
// describes those already-existing tables for the query builder.

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  // Course customization — see the matching ALTER TABLEs in db/sqlite.ts's
  // migrate() and schema.pg.ts for the Postgres side.
  icon: text("icon"),
  color: text("color"),
  cover_image: text("cover_image"),
  icon_image: text("icon_image"),
  show_cover_on_card: integer("show_cover_on_card", { mode: "boolean" }).notNull().default(false),
  show_icon_frame: integer("show_icon_frame", { mode: "boolean" }).notNull().default(true),
  // See the matching columns in schema.pg.ts.
  show_practice: integer("show_practice", { mode: "boolean" }).notNull().default(true),
  lock_background_crop: integer("lock_background_crop", { mode: "boolean" }).notNull().default(false),
  folder_chips: text("folder_chips"),
  page_background_image: text("page_background_image"),
  created_at: text("created_at").notNull(),
});

export const app_settings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  ai_provider: text("ai_provider").notNull().default("api").$type<AiBackend>(),
  // NULL means "use ai_provider" — see the same column in schema.sql.
  image_ai_provider: text("image_ai_provider").$type<AiBackend>(),
  anthropic_api_key: text("anthropic_api_key"),
  openai_api_key: text("openai_api_key"),
  gemini_api_key: text("gemini_api_key"),
  openrouter_api_key: text("openrouter_api_key"),
  show_model_badge: integer("show_model_badge", { mode: "boolean" }).notNull().default(true),
  // Google Calendar integration — see the matching columns/comment in
  // schema.pg.ts.
  google_client_id: text("google_client_id"),
  google_client_secret: text("google_client_secret"),
  google_access_token: text("google_access_token"),
  google_refresh_token: text("google_refresh_token"),
  google_token_expiry: text("google_token_expiry"),
  // JSON-encoded HomeWidgetConfig[] — see the matching column in schema.pg.ts.
  home_widgets: text("home_widgets"),
  // See generation_notifications below — off means a finished generation is
  // recorded there instead of navigating straight to it.
  auto_open_generated_items: integer("auto_open_generated_items", { mode: "boolean" })
    .notNull()
    .default(true),
  // App-wide rebrand — see the matching columns/comment in schema.pg.ts.
  app_name: text("app_name"),
  app_icon: text("app_icon"),
  app_icon_image: text("app_icon_image"),
  app_font: text("app_font"),
  dashboard_background_image: text("dashboard_background_image"),
  // "overlap" | "backdrop" | null (null == "overlap") — see the matching
  // column/comment in schema.pg.ts and the AppSettings.dashboardBannerStyle
  // doc comment in models.ts.
  dashboard_banner_style: text("dashboard_banner_style"),
  // See AppSettings.aiGradingEnabled's doc comment in models.ts.
  ai_grading_enabled: integer("ai_grading_enabled", { mode: "boolean" }).notNull().default(false),
  // See AppSettings.dashboardTransparentWidgets's doc comment in models.ts.
  dashboard_transparent_widgets: integer("dashboard_transparent_widgets", { mode: "boolean" })
    .notNull()
    .default(false),
  // See AppSettings.dashboardLockBackgroundCrop's doc comment in models.ts.
  dashboard_lock_background_crop: integer("dashboard_lock_background_crop", { mode: "boolean" })
    .notNull()
    .default(false),
  // See AppSettings.unlimitedUploads's doc comment in models.ts.
  unlimited_uploads: integer("unlimited_uploads", { mode: "boolean" }).notNull().default(false),
  // See AppSettings.dashboardBackdropFullPage's doc comment in models.ts.
  dashboard_backdrop_full_page: integer("dashboard_backdrop_full_page", { mode: "boolean" })
    .notNull()
    .default(false),
  // See AppSettings.documentBadgesEnabled's doc comment in models.ts.
  document_badges_enabled: integer("document_badges_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.pg.ts and the AppSettings.documentBadgeDetail
  // doc comment in models.ts.
  document_badge_detail: text("document_badge_detail"),
  // See the matching columns in schema.pg.ts.
  folder_chips: text("folder_chips"),
  app_wallpaper: text("app_wallpaper"),
  header_tint: text("header_tint"),
  dashboard_links: text("dashboard_links"),
  hide_course_backdrops: integer("hide_course_backdrops", { mode: "boolean" }).notNull().default(false),
  hide_course_icons: integer("hide_course_icons", { mode: "boolean" }).notNull().default(false),
  dashboard_backdrop_blur: integer("dashboard_backdrop_blur").notNull().default(0),
  // See AppSettings.aiEfficiencyMode's doc comment in models.ts.
  ai_efficiency_mode: integer("ai_efficiency_mode", { mode: "boolean" }).notNull().default(false),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.pg.ts and the AppSettings.modelBadgeDetail
  // doc comment in models.ts.
  model_badge_detail: text("model_badge_detail"),
  // See AppSettings.aiEnabled's doc comment in models.ts.
  ai_enabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(true),
  // See AppSettings.cliTrustedModeEnabled's doc comment in models.ts — relaxes
  // the claude_code/codex_cli backends' sandboxing (Bash/file/network tools,
  // confined to a dedicated workspace dir) when true.
  cli_trusted_mode_enabled: integer("cli_trusted_mode_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  // BCP-47 code (see lib/languages.ts); null == English. What AI-written
  // study plans are written in and which language resources are preferred in.
  preferred_language: text("preferred_language"),
  // FSRS target retention (0.8–0.97); null == 0.9. See lib/fsrs.ts.
  review_retention: real("review_retention"),
  // How many never-seen cards the review queue introduces a day; null == 20.
  new_cards_per_day: integer("new_cards_per_day"),
  // Set once the old SM-2 flashcard history has been replayed into
  // review_items (lib/review/legacyMigration.ts).
  fsrs_migrated_at: text("fsrs_migrated_at"),
  updated_at: text("updated_at").notNull(),
});

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  course_id: integer("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  // Nests to any depth (see lib/folderTree.ts). Cascades so deleting a
  // parent takes its whole subtree with it at the DB level too, as a
  // backstop to models.ts's deleteFolder, which moves every affected
  // folder's documents/items/notes to the course page first (never relying
  // on this cascade for that part).
  parent_folder_id: integer("parent_folder_id").references((): AnySQLiteColumn => folders.id, {
    onDelete: "cascade",
  }),
  icon: text("icon"),
  color: text("color"),
  created_at: text("created_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  // Base64-encoded original PDF bytes — populated on every upload so the
  // file itself travels with the row when synced to Postgres, alongside
  // the local on-disk copy at file_path (always preferred when present;
  // see the document-serving route). Null for rows uploaded before this
  // column existed until a migration backfills them.
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
});

export const generated_items = sqliteTable("generated_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  source_handpicked: integer("source_handpicked", { mode: "boolean" }).notNull().default(false),
  // Which AI backend/model actually generated this item — see
  // lib/aiClient.ts's getModelInfo(). Both nullable: items created before
  // this column existed have neither.
  model_provider: text("model_provider").$type<AiBackend>(),
  model_name: text("model_name"),
  // The study-plan chapter this was generated for (see lib/studyPlan/), so
  // its quiz/flashcard results can count toward that chapter's mastery.
  study_plan_chapter_id: integer("study_plan_chapter_id").references((): AnySQLiteColumn => study_plan_chapters.id, {
    onDelete: "set null",
  }),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const quiz_attempts = sqliteTable("quiz_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  generated_item_id: integer("generated_item_id")
    .notNull()
    .references(() => generated_items.id, { onDelete: "cascade" }),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
  score: real("score"),
  answers_json: text("answers_json"),
});

export const flashcard_reviews = sqliteTable("flashcard_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  generated_item_id: integer("generated_item_id")
    .notNull()
    .references(() => generated_items.id, { onDelete: "cascade" }),
  card_index: integer("card_index").notNull(),
  last_result: text("last_result").notNull().$type<FlashcardResult>(),
  reviewed_at: text("reviewed_at").notNull(),
});

export const flashcard_schedule = sqliteTable(
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
export const generation_notifications = sqliteTable("generation_notifications", {
  generated_item_id: integer("generated_item_id")
    .primaryKey()
    .references(() => generated_items.id, { onDelete: "cascade" }),
  created_at: text("created_at").notNull(),
});

// Read-only external ICS calendar subscriptions — table creation for SQLite
// lives in schema.sql (not migrate()'s ALTER TABLE pattern, since this is a
// whole new table, not a new column on an existing one). See
// lib/calendarFeeds.ts for how these get fetched/parsed/merged.
export const calendar_feeds = sqliteTable("calendar_feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  show_on_calendar: integer("show_on_calendar", { mode: "boolean" }).notNull().default(true),
  show_in_widget: integer("show_in_widget", { mode: "boolean" }).notNull().default(true),
  // Master switch — off means this feed isn't fetched at all (see
  // fetchAllFeedEvents' caller in api/calendar/events/route.ts), not just
  // hidden from one place the way show_on_calendar/show_in_widget are.
  // Pausing a feed like this keeps its URL/label around, unlike deleting it.
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // Own /calendar tab + its JSON settings — see schema.sql's comment.
  own_calendar: integer("own_calendar", { mode: "boolean" }).notNull().default(false),
  calendar_config: text("calendar_config"),
  created_at: text("created_at").notNull(),
});

// The Vault: personal Obsidian-style notes — see the matching comment in
// schema.sql. Title uniqueness is enforced case-insensitively in
// models.ts, not here (see schema.sql's comment on the same table).
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

// Obsidian-style canvases — see the matching comment in schema.sql.
export const canvases = sqliteTable("canvases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  course_id: integer("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
  data: text("data").notNull().default('{"nodes":[],"edges":[]}'),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// Checked-off state for the Assignments widget's checklist — see the
// matching comment in schema.sql for why this keys by the feed event's own
// id rather than a foreign key.
export const completed_assignments = sqliteTable("completed_assignments", {
  event_id: text("event_id").primaryKey(),
  completed_at: text("completed_at").notNull(),
});

// "Last opened" state for the Recent activity widget — see the matching
// comment in schema.sql.
export const recent_views = sqliteTable(
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
export const uploaded_images = sqliteTable("uploaded_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  data_url: text("data_url").notNull(),
  created_at: text("created_at").notNull(),
});

// General-purpose AI chat assistant — see the matching comment in schema.sql.
export const chat_conversations = sqliteTable("chat_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title"),
  // Optional course this conversation is scoped to — see
  // ChatConversation.courseId's doc comment in models.ts. NULL = standalone.
  course_id: integer("course_id").references(() => courses.id, { onDelete: "set null" }),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const chat_messages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

// Saved quiz-generation configurations — see the matching comment in schema.sql.
export const quiz_generation_presets = sqliteTable("quiz_generation_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  single_choice: integer("single_choice", { mode: "boolean" }).notNull().default(true),
  multiple_choice: integer("multiple_choice", { mode: "boolean" }).notNull().default(false),
  short_answer: integer("short_answer", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").notNull(),
});

// AI-built learning roadmap for a course — see the matching comment in
// schema.sql and lib/studyPlan/.
export const study_plans = sqliteTable("study_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  source_handpicked: integer("source_handpicked", { mode: "boolean" }).notNull().default(false),
  language: text("language").notNull(),
  model_provider: text("model_provider").$type<AiBackend>(),
  model_name: text("model_name"),
  used_web_search: integer("used_web_search", { mode: "boolean" }).notNull().default(false),
  error_message: text("error_message"),
  links_checked_at: text("links_checked_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const study_plan_chapters = sqliteTable("study_plan_chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

export const study_plan_resources = sqliteTable("study_plan_resources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

// One dated study session of a plan's schedule — see lib/studyPlan/schedule.ts.
export const study_plan_sessions = sqliteTable("study_plan_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

// A named idea a course's cards and questions test — see lib/review/concepts.ts.
// chapter_id links it to a study plan chapter when it came from the plan's
// subtopics.
export const concepts = sqliteTable(
  "concepts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    course_id: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    chapter_id: integer("chapter_id").references(() => study_plan_chapters.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    created_at: text("created_at").notNull(),
  },
  (table) => [index("idx_concepts_course_id").on(table.course_id)]
);

// FSRS memory state for one flashcard ("card") or quiz question
// ("question"), keyed by its position in the generated item's content —
// see lib/review/store.ts.
export const review_items = sqliteTable(
  "review_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

// Append-only: one row per graded review of a review_items row.
export const review_logs = sqliteTable(
  "review_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    review_item_id: integer("review_item_id")
      .notNull()
      .references(() => review_items.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    confidence: text("confidence").$type<Confidence>(),
    source: text("source").notNull().$type<ReviewSource>(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
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

// The mistake log — see lib/review/mistakes.ts.
export const mistakes = sqliteTable(
  "mistakes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

// Past-exam analysis per course (lib/exams/analyze.ts): the style,
// weighting and task mix mock exams are generated to match.
export const exam_profiles = sqliteTable("exam_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export const mock_exams = sqliteTable(
  "mock_exams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
export const mock_exam_attempts = sqliteTable(
  "mock_exam_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
export const exam_dates = sqliteTable("exam_dates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export const explain_sessions = sqliteTable(
  "explain_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
export const problem_sets = sqliteTable(
  "problem_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
export const source_checks = sqliteTable(
  "source_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
export const code_sets = sqliteTable(
  "code_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
