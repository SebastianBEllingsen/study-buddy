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
  ChatRole,
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
  // See AppSettings.documentBadgesEnabled's doc comment in models.ts.
  document_badges_enabled: boolean("document_badges_enabled").notNull().default(true),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.sqlite.ts and the AppSettings.documentBadgeDetail
  // doc comment in models.ts.
  document_badge_detail: text("document_badge_detail"),
  // See AppSettings.aiEfficiencyMode's doc comment in models.ts.
  ai_efficiency_mode: boolean("ai_efficiency_mode").notNull().default(false),
  // "detailed" | "minimal" | null (null == "detailed") — see the matching
  // column/comment in schema.sqlite.ts and the AppSettings.modelBadgeDetail
  // doc comment in models.ts.
  model_badge_detail: text("model_badge_detail"),
  // See AppSettings.aiEnabled's doc comment in models.ts.
  ai_enabled: boolean("ai_enabled").notNull().default(true),
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
  icon: text("icon"),
  color: text("color"),
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
  // True for a hand-picked "choose documents" selection — also leaves
  // source_folder_id null (not scoped to one folder) but is distinct from a
  // pooled "all course material" generation. See schema.sql and
  // getNewDocumentsForItem in models.ts.
  source_handpicked: boolean("source_handpicked").notNull().default(false),
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
  icon: text("icon"),
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
export const uploaded_images = pgTable("uploaded_images", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  data_url: text("data_url").notNull(),
  created_at: text("created_at").notNull(),
});

// General-purpose AI chat assistant — see the matching comment in schema.sql.
export const chat_conversations = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  title: text("title"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const chat_messages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversation_id: integer("conversation_id")
    .notNull()
    .references(() => chat_conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull().$type<ChatRole>(),
  content: text("content").notNull(),
  created_at: text("created_at").notNull(),
});

// Saved quiz-generation configurations — see the matching comment in schema.sql.
export const quiz_generation_presets = pgTable("quiz_generation_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  single_choice: boolean("single_choice").notNull().default(true),
  multiple_choice: boolean("multiple_choice").notNull().default(false),
  short_answer: boolean("short_answer").notNull().default(true),
  created_at: text("created_at").notNull(),
});
