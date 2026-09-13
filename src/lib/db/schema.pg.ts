import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  DocumentStatus,
  GenerationMode,
  FlashcardResult,
  AiBackend,
} from "../models";

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
  created_at: text("created_at").notNull(),
});

export const app_settings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  ai_provider: text("ai_provider").notNull().default("api").$type<AiBackend>(),
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
  updated_at: text("updated_at").notNull(),
});

export const folders = pgTable("folders", {
  id: serial("id").primaryKey(),
  course_id: integer("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  is_master: boolean("is_master").notNull().default(false),
  position: integer("position").notNull().default(0),
  // See schema.sqlite.ts — same one-level-nesting rule and cascade backstop.
  parent_folder_id: integer("parent_folder_id").references((): AnyPgColumn => folders.id, {
    onDelete: "cascade",
  }),
  created_at: text("created_at").notNull(),
});

export const documents = pgTable("documents", {
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
  created_at: text("created_at").notNull(),
});

export const generated_items = pgTable("generated_items", {
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
  model_provider: text("model_provider").$type<AiBackend>(),
  model_name: text("model_name"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const quiz_attempts = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),
  generated_item_id: integer("generated_item_id")
    .notNull()
    .references(() => generated_items.id, { onDelete: "cascade" }),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
  score: real("score"),
  answers_json: text("answers_json"),
});

export const flashcard_reviews = pgTable("flashcard_reviews", {
  id: serial("id").primaryKey(),
  generated_item_id: integer("generated_item_id")
    .notNull()
    .references(() => generated_items.id, { onDelete: "cascade" }),
  card_index: integer("card_index").notNull(),
  last_result: text("last_result").notNull().$type<FlashcardResult>(),
  reviewed_at: text("reviewed_at").notNull(),
});

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

// Read-only external ICS calendar subscriptions — see the matching table in
// schema.sql (SQLite) and lib/calendarFeeds.ts for how these get fetched,
// parsed, and merged into the Google Calendar events list at read time.
export const calendar_feeds = pgTable("calendar_feeds", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  show_on_calendar: boolean("show_on_calendar").notNull().default(true),
  show_in_widget: boolean("show_in_widget").notNull().default(true),
  created_at: text("created_at").notNull(),
});

// The Vault: personal Obsidian-style notes — see the matching comment in
// schema.sql. Title uniqueness is enforced case-insensitively in
// models.ts, not here (see schema.sql's comment on the same table).
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  // Nullable — see the matching comment in schema.sql for why (ALTER'd
  // onto this table after it shipped; application code always populates
  // both).
  course_id: integer("course_id").references(() => courses.id, { onDelete: "cascade" }),
  folder_id: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
  markdown: text("markdown").notNull().default(""),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// Checked-off state for the Assignments widget's checklist — see the
// matching comment in schema.sql for why this keys by the feed event's own
// id rather than a foreign key.
export const completed_assignments = pgTable("completed_assignments", {
  event_id: text("event_id").primaryKey(),
  completed_at: text("completed_at").notNull(),
});
