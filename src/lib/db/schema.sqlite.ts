import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type {
  DocumentStatus,
  GenerationMode,
  FlashcardResult,
  AiBackend,
  ChatRole,
} from "../models";

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
  // See AppSettings.documentBadgesEnabled's doc comment in models.ts.
  document_badges_enabled: integer("document_badges_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.pg.ts and the AppSettings.documentBadgeDetail
  // doc comment in models.ts.
  document_badge_detail: text("document_badge_detail"),
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
  updated_at: text("updated_at").notNull(),
});

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  course_id: integer("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  is_master: integer("is_master", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull().default(0),
  // One level of nesting only — a subfolder's own parent_folder_id is
  // always null. Cascades so deleting a parent takes its subfolders with
  // it at the DB level too, as a backstop to models.ts's deleteFolder,
  // which reassigns their documents/items to the course's master folder
  // first (never relying on this cascade for that part).
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
