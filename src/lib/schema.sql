CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ai_backend TEXT NOT NULL DEFAULT 'api' CHECK (ai_backend IN ('api', 'claude_code')), -- legacy; superseded by ai_provider (see migrate() in db.ts)
  ai_provider TEXT NOT NULL DEFAULT 'api', -- 'api' | 'claude_code' | 'openai' | 'gemini' | 'free'
  -- NULL (default) means "use ai_provider above" — an override for image-
  -- bearing requests only (Crop & Ask), since claude_code/codex_cli can't
  -- take image input at all (see aiBackends/claudeCode.ts, codexCli.ts).
  -- Restricted to the 4 backends that actually support images: 'api' |
  -- 'openai' | 'gemini' | 'free'.
  image_ai_provider TEXT,
  anthropic_api_key TEXT,
  openai_api_key TEXT,
  gemini_api_key TEXT,
  openrouter_api_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only ai_backend here (not ai_provider): on a database from before
-- ai_provider existed, this INSERT runs before migrate() has a chance to add
-- the column, so referencing it here would break that case. A fresh
-- database gets ai_provider = 'api' from the column's own DEFAULT; migrate()
-- backfills it for pre-existing databases.
INSERT OR IGNORE INTO app_settings (id, ai_backend) VALUES (1, 'api');

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_folders_course_id ON folders(course_id);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  extracted_text TEXT,
  page_count INTEGER,
  char_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'extracted' | 'failed' | 'image'
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_course_id ON documents(course_id);
-- idx_documents_folder_id is created in db.ts's migrate(), after folder_id is
-- guaranteed to exist on documents (it may have just been added via ALTER
-- TABLE on a database created before folders existed).

CREATE TABLE IF NOT EXISTS generated_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  mode TEXT NOT NULL, -- 'notes' | 'quiz' | 'flashcards'
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  source_document_ids TEXT NOT NULL, -- JSON array
  -- The folder this was actually GENERATED from — NULL means "all course
  -- material" (pooled across every folder). Distinct from folder_id above,
  -- which is only where the item is FILED: a pooled generation is stored in
  -- the course's default folder but its source material spans every folder,
  -- so folder_id alone isn't enough to know what counts as "new" later.
  source_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  -- 1 when generated via a hand-picked "choose documents" selection, which
  -- (like "all course material") also leaves source_folder_id NULL since it
  -- isn't scoped to any single folder — distinguishes the two so
  -- getNewDocumentsForItem (models.ts) knows a hand-picked item has no
  -- coherent folder to check new uploads against, rather than treating it
  -- as pooled across the whole course.
  source_handpicked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_generated_items_course_id ON generated_items(course_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_item_id INTEGER NOT NULL REFERENCES generated_items(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  score REAL,
  answers_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_item_id ON quiz_attempts(generated_item_id);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_item_id INTEGER NOT NULL REFERENCES generated_items(id) ON DELETE CASCADE,
  card_index INTEGER NOT NULL,
  last_result TEXT NOT NULL, -- 'again' | 'hard' | 'good' | 'easy'
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_item_id ON flashcard_reviews(generated_item_id);

-- Current per-card scheduling STATE (one row per card, upserted in place) —
-- distinct from flashcard_reviews above, which is an append-only historical
-- log of every review event and is never read back for scheduling. A card
-- with no row here yet has never been reviewed and is due immediately.
CREATE TABLE IF NOT EXISTS flashcard_schedule (
  generated_item_id INTEGER NOT NULL REFERENCES generated_items(id) ON DELETE CASCADE,
  card_index INTEGER NOT NULL,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at TEXT,
  PRIMARY KEY (generated_item_id, card_index)
);

-- One row per finished generation the user hasn't yet acted on (opened it,
-- or explicitly dismissed) — only created at all when app_settings'
-- auto_open_generated_items is off (see the generate route), since when it's
-- on the user is taken straight there and there's nothing left to notify
-- about. ON DELETE CASCADE means deleting the generated item itself (e.g.
-- deleting a quiz before ever opening it) removes its notification too, with
-- no extra cleanup code needed.
CREATE TABLE IF NOT EXISTS generation_notifications (
  generated_item_id INTEGER PRIMARY KEY REFERENCES generated_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Read-only external ICS calendar subscriptions (e.g. a university student
-- portal's timetable feed, an LMS's assignment-due-dates feed) — merged
-- into the Google Calendar events list at read time (see
-- lib/calendarFeeds.ts), never written back to.
CREATE TABLE IF NOT EXISTS calendar_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  -- Independently toggleable: a feed can back the Assignments widget's
  -- checklist without also cluttering the /calendar month grid, or vice
  -- versa. Both default on (a newly added feed shows up everywhere).
  show_on_calendar INTEGER NOT NULL DEFAULT 1,
  show_in_widget INTEGER NOT NULL DEFAULT 1,
  -- Master switch: off means this feed isn't fetched at all, not just
  -- hidden from one place. Pausing keeps its URL/label around, unlike
  -- deleting it.
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Gives this feed its own tab on /calendar (a week grid, see
  -- components/calendar/FeedWeekView.tsx) instead of only being blended
  -- into the shared views. calendar_config is that tab's JSON settings
  -- (hour range, weekends, per-course colours/aliases) — see
  -- parseFeedCalendarConfig in models.ts for the shape and defaults.
  own_calendar INTEGER NOT NULL DEFAULT 0,
  calendar_config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The Vault: personal Obsidian-style notes, deliberately separate from a
-- course's AI-generated "notes" GenerationMode (a per-course study-notes
-- document) — these are user-authored, and organized into courses/folders
-- the same way documents/generated_items are (course_id/folder_id/position;
-- see listNotesForCourse). They still link to each other and to course
-- material ACROSS courses via [[note:ID]] / [[doc:ID#snippet]] /
-- [[item:ID#snippet]] syntax (see lib/noteLinks.ts) — organization is
-- per-course, but linking isn't. Backlinks are computed at read time by
-- scanning every note's markdown rather than maintained in a separate links
-- table — cheap at personal-vault scale and never goes stale on an edit.
-- Title uniqueness (so a [[wikilink]] unambiguously resolves to one note) is
-- enforced case-insensitively in application code (see models.ts), not by a
-- DB constraint here — SQLite's COLLATE NOCASE and Postgres's lower()
-- indexes aren't expressible identically across both schema files, and a
-- personal single-user vault doesn't need a DB-level race guard on top of
-- the app-level check.
--
-- course_id is nullable purely because it was ALTER'd onto this table after
-- it already shipped — SQLite's ALTER TABLE ADD COLUMN can't add a NOT NULL
-- column without a default, and there's no meaningful default course to
-- fall back to. Application code (models.ts's createNote) always populates
-- it. folder_id is nullable by design, same as documents/generated_items —
-- null means the note is filed directly on the course page rather than
-- inside any folder.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Not indexed here (unlike idx_documents_course_id below): this file runs
-- unconditionally on every startup, before migrate()'s ALTER TABLEs below
-- have added course_id to a database that already had this table from
-- before that column existed — indexing it here would fail on exactly that
-- upgrade path. See sqlite.ts's migrate() for where this index is created,
-- after the column is guaranteed to exist.

-- Obsidian-style canvases: an infinite board of cards (markdown text, or a
-- reference to a note/document/generated item/uploaded image) joined by
-- labeled arrows. Listed in their own section of a course page rather than
-- inside the folder tree, so there's no folder_id. `data` holds the whole
-- board as one JSON Canvas 1.0 document (https://jsoncanvas.org — Obsidian's
-- own open .canvas format; see lib/canvas.ts for the parser and the
-- "note:12"-style file references used here), saved wholesale on every
-- autosave rather than normalized into node/edge tables — a canvas is
-- always loaded and edited as a single unit, and keeping the format
-- verbatim means it can be exported to/imported from Obsidian as-is.
CREATE TABLE IF NOT EXISTS canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canvases_course_id ON canvases(course_id);

-- Which feed-sourced calendar events the Assignments widget's checklist has
-- been ticked off for. Keyed by the event's own id (see calendarFeeds.ts's
-- `${feed.label}:${uid}:${instance.start}` — stable across refetches of the
-- same ICS feed) rather than a foreign key, since feed events are never
-- rows of their own — they're parsed fresh from the feed URL on every read.
CREATE TABLE IF NOT EXISTS completed_assignments (
  event_id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Current "last opened" STATE for the Recent activity dashboard widget — one
-- row per (item_type, item_id), upserted in place on every view, same
-- one-row-per-thing shape as flashcard_schedule above. Not an append-only
-- log: the widget only ever needs the most recent visit to each item, never
-- a full history, so there's nothing to gain from keeping every past visit
-- (and every unbounded-growth cleanup problem that would come with it).
CREATE TABLE IF NOT EXISTS recent_views (
  item_type TEXT NOT NULL, -- 'note' | 'document' | 'item' | 'canvas'
  item_id INTEGER NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_type, item_id)
);

-- A reusable library of every icon/cover image ever cropped and uploaded
-- (CustomizeCourseDialog today; any future per-thing image customization
-- can point at the same library) — append-only, so a "pick from what
-- you've used before" gallery has something to browse instead of only ever
-- offering a fresh upload from disk. Stored inline as a data URL, same
-- choice as courses.cover_image/icon_image (see the comment there): no
-- filesystem dependency, syncs cleanly with the Supabase backend.
CREATE TABLE IF NOT EXISTS uploaded_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, -- 'icon' | 'cover' | 'background' — same aspect-ratio split as CustomizeCourseDialog
  data_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uploaded_images_kind ON uploaded_images(kind);

-- A general-purpose AI chat assistant, independent of any course/document —
-- see components/ChatDialog.tsx and lib/chat.ts. One row per conversation;
-- chat_messages' ON DELETE CASCADE means deleting a conversation cleans up
-- its messages too, no extra code needed.
CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, -- NULL until the first exchange sets it — see lib/chat.ts
  -- Optional course this conversation is scoped to — see
  -- ChatConversation.courseId's doc comment in models.ts. NULL = standalone.
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  -- JSON-encoded ChatAttachment[] (see models.ts) — NULL when the message has
  -- no attachments.
  attachments TEXT,
  -- JSON-encoded PendingChatAction (see chatActions.ts / models.ts) — NULL
  -- unless this assistant message proposed a folder/save action.
  pending_action TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);

-- Saved quiz-generation configurations (e.g. "only text answers", "only
-- multiple choice") — see lib/types.ts's QuizGenerationSettings and
-- components/QuizGenerationDialog.tsx. Column names deliberately mirror
-- QuizGenerationSettings' own field names (snake_case), same convention as
-- every other table here.
CREATE TABLE IF NOT EXISTS quiz_generation_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  single_choice INTEGER NOT NULL DEFAULT 1,
  multiple_choice INTEGER NOT NULL DEFAULT 0,
  short_answer INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
