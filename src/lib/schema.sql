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
  -- 'official' (authoritative: a course's own material, a textbook,
  -- official documentation) or
  -- 'personal' (the student's own notes) — generation trusts official
  -- sources over personal ones where they disagree.
  trust TEXT NOT NULL DEFAULT 'official',
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
  -- NULL: not used for generation. 'official' / 'personal': included in
  -- generation from this course, with that trust level (see documents.trust).
  generation_source TEXT,
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

-- AI-built learning roadmap for a course (lib/studyPlan/): an ordered list
-- of chapters, each with a subtopic checklist and web resources to study in
-- order. One plan per course — regenerating replaces it (see
-- replaceStudyPlan in lib/studyPlan/store.ts). Normalized into three tables
-- rather than one JSON blob because a plan takes many small edits (ticking
-- a subtopic, a link check updating one resource's status) and link
-- checking works per row.
CREATE TABLE IF NOT EXISTS study_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL, -- 'draft_topics' | 'generating' | 'ready' | 'failed'
  preset TEXT NOT NULL, -- 'roadmap' | 'guided'
  options_json TEXT NOT NULL,
  syllabus_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  syllabus_text TEXT,
  source_document_ids TEXT NOT NULL,
  source_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  source_handpicked INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  used_web_search INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  links_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- stage: chapters sharing a stage can be studied in parallel. JSON columns
-- hold small per-chapter lists always edited together with their chapter.
CREATE TABLE IF NOT EXISTS study_plan_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  stage INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  subtopics_json TEXT NOT NULL DEFAULT '[]',
  prerequisite_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_document_ids_json TEXT NOT NULL DEFAULT '[]',
  current_level TEXT,
  estimated_minutes INTEGER,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_study_plan_chapters_plan_id ON study_plan_chapters(plan_id);

-- position is the "study in order" sequence within a chapter. origin 'user'
-- rows are hand-added and survive "regenerate resources".
CREATE TABLE IF NOT EXISTS study_plan_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES study_plan_chapters(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  provider TEXT,
  language TEXT,
  note TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'ai',
  link_status TEXT NOT NULL DEFAULT 'unchecked',
  status_detail TEXT,
  checked_at TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_study_plan_resources_chapter_id ON study_plan_resources(chapter_id);

-- A plan's schedule: one row per dated study session (lib/studyPlan/
-- schedule.ts). `date` is a plain YYYY-MM-DD day. google_event_id is set
-- once the session has been pushed to the user's Google Calendar.
CREATE TABLE IF NOT EXISTS study_plan_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES study_plan_chapters(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'study',
  done_at TEXT,
  google_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_study_plan_sessions_plan_id ON study_plan_sessions(plan_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_sessions_date ON study_plan_sessions(date);

-- Concepts: the named ideas a course's cards and questions test (lib/review/
-- concepts.ts). chapter_id is set when the concept is a study plan subtopic.
CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES study_plan_chapters(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_concepts_course_id ON concepts(course_id);

-- FSRS memory state per flashcard ('card') or quiz question ('question'),
-- keyed by its index in the item's content like flashcard_schedule was
-- (lib/review/store.ts reconciles indexes when cards are removed). state is
-- ts-fsrs's State enum: 0 new, 1 learning, 2 review, 3 relearning.
-- Replaces flashcard_schedule, which is kept only for old data.
CREATE TABLE IF NOT EXISTS review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_item_id INTEGER NOT NULL REFERENCES generated_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  concept_id INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
  due_at TEXT NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_item_kind_index ON review_items(generated_item_id, kind, item_index);
CREATE INDEX IF NOT EXISTS idx_review_items_due_at ON review_items(due_at);

-- Append-only log of graded reviews (rating is ts-fsrs's Rating, 1-4).
-- source is where the answer was given: 'deck' (a flashcard set), 'quiz'
-- (a quiz attempt), 'queue' (the review session), 'exam' (a graded mock
-- exam task) or 'legacy' (replayed
-- from the old SM-2 history).
CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_item_id INTEGER NOT NULL REFERENCES review_items(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  confidence TEXT,
  source TEXT NOT NULL,
  correct INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  scheduled_days INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_logs_review_item_id ON review_logs(review_item_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed_at ON review_logs(reviewed_at);

-- The mistake log (lib/review/mistakes.ts): wrong quiz answers and cards
-- rated "Again", resolved once recalled correctly on two later days.
CREATE TABLE IF NOT EXISTS mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_item_id INTEGER NOT NULL REFERENCES generated_items(id) ON DELETE CASCADE,
  review_item_id INTEGER REFERENCES review_items(id) ON DELETE SET NULL,
  concept_id INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  given_answer TEXT,
  correct_answer TEXT NOT NULL,
  confidence TEXT,
  misconception TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mistakes_generated_item_id ON mistakes(generated_item_id);

-- Mock exams from past exams (lib/exams/). exam_profiles holds the analysis
-- of a course's past exams (one per course); mock_exams the generated
-- exams, each with tasks, rubrics and model solutions in tasks_json, and
-- the practice quiz its tasks are reviewed through; mock_exam_attempts one
-- sitting each: answers (typed and/or photos), status 'in_progress' |
-- 'grading' | 'graded' | 'failed', and the graded results.
CREATE TABLE IF NOT EXISTS exam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
  source_document_ids_json TEXT NOT NULL DEFAULT '[]',
  profile_json TEXT NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mock_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  total_points REAL NOT NULL,
  tasks_json TEXT NOT NULL,
  practice_item_id INTEGER REFERENCES generated_items(id) ON DELETE SET NULL,
  model_provider TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mock_exams_course_id ON mock_exams(course_id);

CREATE TABLE IF NOT EXISTS mock_exam_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mock_exam_id INTEGER NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '[]',
  results_json TEXT,
  score REAL,
  error_message TEXT,
  started_at TEXT NOT NULL,
  paused_at TEXT,
  paused_seconds INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_exam_id ON mock_exam_attempts(mock_exam_id);

-- A course's exam date (lib/readiness/).
CREATE TABLE IF NOT EXISTS exam_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Blurt / Feynman sessions (lib/explain/): kind 'blurt' | 'feynman',
-- status 'open' | 'done'; messages_json is the conversation, result_json
-- the gaps found, practice_item_id the flashcard deck gaps were added to.
CREATE TABLE IF NOT EXISTS explain_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES study_plan_chapters(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  practice_item_id INTEGER REFERENCES generated_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_explain_sessions_course_id ON explain_sessions(course_id);

-- Problem-solving practice (lib/problems/): kind 'coach' (worked → faded →
-- independent) or 'mixed' (interleaved across concepts).
CREATE TABLE IF NOT EXISTS problem_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES study_plan_chapters(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '[]',
  practice_item_id INTEGER REFERENCES generated_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_problem_sets_course_id ON problem_sets(course_id);

-- Source conflict checks (lib/sources/conflicts.ts): the latest findings
-- of comparing a course's documents and generation notes with each other.
-- source_keys_json lists the sources checked ("doc:ID" / "note:ID") so the
-- page can tell when new material has arrived since.
CREATE TABLE IF NOT EXISTS source_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_keys_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_checks_course_id ON source_checks(course_id);

-- Code exercises (lib/code/): programming practice whose tests run in the
-- learner's browser. content_json holds the exercises, progress_json the
-- learner's code and results; practice_item_id is the quiz its finished
-- exercises are reviewed through.
CREATE TABLE IF NOT EXISTS code_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES study_plan_chapters(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  content_json TEXT NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '[]',
  practice_item_id INTEGER REFERENCES generated_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_code_sets_course_id ON code_sets(course_id);
