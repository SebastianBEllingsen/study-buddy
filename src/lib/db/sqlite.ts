import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.sqlite";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "study_buddy.db");
const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

declare global {
  var __studyBuddySqlite: Database.Database | undefined;
}

// Ad-hoc migrations for columns added after a database already exists on
// disk — schema.sql's CREATE TABLE IF NOT EXISTS won't retrofit existing
// tables, so new nullable columns are added here if missing. Kept minimal
// on purpose: this is a single-user local SQLite file, not a fleet that
// needs a migration framework.
//
// This runs against the raw better-sqlite3 connection, not through Drizzle —
// it predates Drizzle's introduction and encodes real historical data-shape
// changes (the old two-tree folder merge, position backfills) that a fresh
// Drizzle migration can't replicate for upgrading users. Drizzle only wraps
// the connection afterward, as a query builder over whatever shape this
// leaves the database in.
function migrate(database: Database.Database) {
  const hasColumn = (table: string, column: string) =>
    (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === column
    );

  if (!hasColumn("documents", "folder_id")) {
    database.exec(
      "ALTER TABLE documents ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL"
    );
  }
  if (!hasColumn("documents", "file_base64")) {
    database.exec("ALTER TABLE documents ADD COLUMN file_base64 TEXT");
  }
  if (!hasColumn("generated_items", "folder_id")) {
    database.exec(
      "ALTER TABLE generated_items ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL"
    );
  }
  if (!hasColumn("folders", "is_master")) {
    database.exec(
      "ALTER TABLE folders ADD COLUMN is_master INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("folders", "parent_folder_id")) {
    database.exec(
      "ALTER TABLE folders ADD COLUMN parent_folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE"
    );
  }

  if (!hasColumn("app_settings", "ai_provider")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN ai_provider TEXT");
    // Backfill from the legacy ai_backend column, which only ever held 'api'
    // or 'claude_code' — both remain valid ai_provider values.
    database.exec(
      "UPDATE app_settings SET ai_provider = ai_backend WHERE ai_provider IS NULL"
    );
  }
  for (const col of [
    "anthropic_api_key",
    "openai_api_key",
    "gemini_api_key",
    "openrouter_api_key",
  ]) {
    if (!hasColumn("app_settings", col)) {
      database.exec(`ALTER TABLE app_settings ADD COLUMN ${col} TEXT`);
    }
  }
  if (!hasColumn("app_settings", "show_model_badge")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN show_model_badge INTEGER NOT NULL DEFAULT 1"
    );
  }

  if (!hasColumn("generated_items", "model_provider")) {
    database.exec("ALTER TABLE generated_items ADD COLUMN model_provider TEXT");
  }
  if (!hasColumn("generated_items", "model_name")) {
    database.exec("ALTER TABLE generated_items ADD COLUMN model_name TEXT");
  }

  if (!hasColumn("generated_items", "updated_at")) {
    // SQLite's ALTER TABLE ADD COLUMN rejects non-constant defaults like
    // datetime('now') — add it nullable, then backfill explicitly.
    database.exec("ALTER TABLE generated_items ADD COLUMN updated_at TEXT");
    database.exec("UPDATE generated_items SET updated_at = created_at");
  }

  if (!hasColumn("generated_items", "source_folder_id")) {
    database.exec(
      "ALTER TABLE generated_items ADD COLUMN source_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL"
    );
    // Backfill heuristic for items that predate this column: a generation
    // scoped to one folder can only have pulled documents from that same
    // folder, so if any of an item's source documents live in a DIFFERENT
    // folder than the item itself, the generation must have been pooled
    // ("all course material") — source_folder_id stays NULL. Otherwise,
    // treat it as scoped to the folder it's already filed in.
    const items = database
      .prepare("SELECT id, folder_id, source_document_ids FROM generated_items")
      .all() as { id: number; folder_id: number; source_document_ids: string }[];
    const getDocFolder = database.prepare(
      "SELECT folder_id FROM documents WHERE id = ?"
    );
    const setSourceFolder = database.prepare(
      "UPDATE generated_items SET source_folder_id = ? WHERE id = ?"
    );
    for (const item of items) {
      let sourceIds: number[] = [];
      try {
        sourceIds = JSON.parse(item.source_document_ids);
      } catch {
        continue;
      }
      const allSameFolder = sourceIds.every((docId) => {
        const row = getDocFolder.get(docId) as { folder_id: number } | undefined;
        return row?.folder_id === item.folder_id;
      });
      if (allSameFolder) {
        setSourceFolder.run(item.folder_id, item.id);
      }
      // else: leave NULL (pooled) — already the ALTER's implicit default.
    }
  }

  if (!hasColumn("courses", "position")) {
    database.exec("ALTER TABLE courses ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Backfill newest-first (matching the previous created_at DESC display
    // order) so existing course order doesn't visibly change on upgrade —
    // new courses are prepended from here on (see createCourse), unlike
    // folders which append, since courses already had a "newest first"
    // expectation that folders never did.
    const ordered = database
      .prepare("SELECT id FROM courses ORDER BY created_at DESC")
      .all() as { id: number }[];
    const setPosition = database.prepare("UPDATE courses SET position = ? WHERE id = ?");
    ordered.forEach((c, i) => setPosition.run(i, c.id));
  }

  // Captured before any ALTER below touches these columns, so the branches
  // further down can tell what state this database was actually in.
  const hadTreeColumn = hasColumn("folders", "tree");
  const hadPositionColumn = hasColumn("folders", "position");

  if (!hadPositionColumn) {
    database.exec(
      "ALTER TABLE folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
    );
  }

  // Created here rather than in schema.sql: on a database created before
  // folders existed, folder_id is only guaranteed to exist on documents
  // after the ALTER TABLE above runs, so an inline CREATE INDEX in
  // schema.sql (which runs first) would fail on that column not existing yet.
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id)"
  );

  // Every course must have exactly one permanent default folder, and every
  // document/generated_item must belong to a real folder — no NULL
  // ("floating") state. Backfill both invariants for data that predates
  // this: create a default folder for any course missing one, then reassign
  // any NULL folder_id rows to it. Tree-agnostic — safe to run regardless of
  // which era of the folder feature this database is coming from.
  const coursesMissingDefault = database
    .prepare(
      `SELECT id FROM courses WHERE id NOT IN (
         SELECT course_id FROM folders WHERE is_master = 1
       )`
    )
    .all() as { id: number }[];

  if (coursesMissingDefault.length > 0) {
    const insertDefault = database.prepare(
      "INSERT INTO folders (course_id, name, is_master) VALUES (?, 'Unsorted', 1)"
    );
    const backfillDocuments = database.prepare(
      "UPDATE documents SET folder_id = ? WHERE course_id = ? AND folder_id IS NULL"
    );
    const backfillItems = database.prepare(
      "UPDATE generated_items SET folder_id = ? WHERE course_id = ? AND folder_id IS NULL"
    );

    const backfillCourse = database.transaction((courseId: number) => {
      const { lastInsertRowid } = insertDefault.run(courseId);
      backfillDocuments.run(lastInsertRowid, courseId);
      backfillItems.run(lastInsertRowid, courseId);
    });

    for (const { id } of coursesMissingDefault) {
      backfillCourse(id);
    }
  }

  const backfillPositions = (courseId: number) => {
    const ordered = database
      .prepare(
        "SELECT id FROM folders WHERE course_id = ? ORDER BY is_master DESC, created_at ASC"
      )
      .all(courseId) as { id: number }[];
    const setPosition = database.prepare(
      "UPDATE folders SET position = ? WHERE id = ?"
    );
    ordered.forEach((f, i) => setPosition.run(i, f.id));
  };

  if (hadTreeColumn) {
    // One-time merge: collapse the old two-tree model (an "Uploaded Content"
    // tree and a mirrored "Generated Content" tree, e.g. two separate
    // "Test 1" folders with no real containment between them) back into a
    // single folder tree per course — each folder now holds both its
    // documents and its generated items directly.
    type FolderRow = {
      id: number;
      name: string;
      is_master: number;
      tree: "uploads" | "generated";
    };

    const courseIds = (
      database.prepare("SELECT id FROM courses").all() as { id: number }[]
    ).map((r) => r.id);

    const mergeCourse = database.transaction((courseId: number) => {
      const roots = database
        .prepare("SELECT * FROM folders WHERE course_id = ? AND is_master = 1")
        .all(courseId) as FolderRow[];
      const uploadsRoot = roots.find((r) => r.tree === "uploads");
      const generatedRoot = roots.find((r) => r.tree === "generated");

      if (uploadsRoot && generatedRoot) {
        database
          .prepare("UPDATE generated_items SET folder_id = ? WHERE folder_id = ?")
          .run(uploadsRoot.id, generatedRoot.id);
        database.prepare("DELETE FROM folders WHERE id = ?").run(generatedRoot.id);
      }
      const canonicalRootId = uploadsRoot?.id ?? generatedRoot?.id;
      if (canonicalRootId != null) {
        database
          .prepare("UPDATE folders SET name = 'Unsorted' WHERE id = ?")
          .run(canonicalRootId);
      }

      // Merge same-named topic-folder pairs (e.g. both "Test 1" folders)
      // into the uploads-side folder; anything without a same-named match
      // on the uploads side is simply left as-is — it becomes an ordinary
      // folder once the tree column is dropped below, no data lost.
      const topics = database
        .prepare("SELECT * FROM folders WHERE course_id = ? AND is_master = 0")
        .all(courseId) as FolderRow[];
      const uploadsTopics = topics.filter((f) => f.tree === "uploads");
      const generatedTopics = topics.filter((f) => f.tree === "generated");

      for (const gen of generatedTopics) {
        const match = uploadsTopics.find((u) => u.name === gen.name);
        if (match) {
          database
            .prepare("UPDATE generated_items SET folder_id = ? WHERE folder_id = ?")
            .run(match.id, gen.id);
          database.prepare("DELETE FROM folders WHERE id = ?").run(gen.id);
        }
      }

      backfillPositions(courseId);
    });

    for (const id of courseIds) {
      mergeCourse(id);
    }

    try {
      database.exec("ALTER TABLE folders DROP COLUMN tree");
    } catch (err) {
      // Non-fatal: the column just becomes vestigial (unused by any app
      // code from here on) rather than blocking startup if the bundled
      // SQLite version can't drop it for some reason.
      console.warn("Could not drop folders.tree column:", err);
    }
  } else if (!hadPositionColumn) {
    // Position is new but there was no tree to merge (fresh single-tree
    // install, or a database that already went through the merge above in
    // an earlier run) — still give existing folders a stable, sensible
    // initial order instead of leaving them all at position 0.
    const courseIds = (
      database.prepare("SELECT id FROM courses").all() as { id: number }[]
    ).map((r) => r.id);
    for (const id of courseIds) {
      backfillPositions(id);
    }
  }

  if (!hasColumn("courses", "icon")) {
    database.exec("ALTER TABLE courses ADD COLUMN icon TEXT");
  }
  if (!hasColumn("courses", "color")) {
    database.exec("ALTER TABLE courses ADD COLUMN color TEXT");
  }
  if (!hasColumn("courses", "cover_image")) {
    database.exec("ALTER TABLE courses ADD COLUMN cover_image TEXT");
  }
  if (!hasColumn("courses", "icon_image")) {
    database.exec("ALTER TABLE courses ADD COLUMN icon_image TEXT");
  }
  if (!hasColumn("courses", "show_cover_on_card")) {
    database.exec("ALTER TABLE courses ADD COLUMN show_cover_on_card INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn("courses", "show_icon_frame")) {
    database.exec("ALTER TABLE courses ADD COLUMN show_icon_frame INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasColumn("calendar_feeds", "show_on_calendar")) {
    database.exec("ALTER TABLE calendar_feeds ADD COLUMN show_on_calendar INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn("calendar_feeds", "show_in_widget")) {
    database.exec("ALTER TABLE calendar_feeds ADD COLUMN show_in_widget INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasColumn("notes", "course_id")) {
    database.exec("ALTER TABLE notes ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE");
  }
  if (!hasColumn("notes", "folder_id")) {
    database.exec("ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL");
  }
  if (!hasColumn("notes", "position")) {
    database.exec("ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
  }
  // Safe to run every startup — column is guaranteed to exist by this
  // point, whether from a fresh schema.sql or the ALTER TABLEs just above.
  database.exec("CREATE INDEX IF NOT EXISTS idx_notes_course_id ON notes(course_id)");

  if (!hasColumn("documents", "position")) {
    database.exec("ALTER TABLE documents ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Backfill matching the previous created_at ASC display order (oldest
    // first — new uploads were always appended), scoped per folder since
    // reorderDocuments only ever reorders within one folder at a time.
    const folderIds = (
      database.prepare("SELECT DISTINCT folder_id FROM documents").all() as {
        folder_id: number;
      }[]
    ).map((r) => r.folder_id);
    const setDocPosition = database.prepare("UPDATE documents SET position = ? WHERE id = ?");
    for (const folderId of folderIds) {
      const ordered = database
        .prepare("SELECT id FROM documents WHERE folder_id = ? ORDER BY created_at ASC")
        .all(folderId) as { id: number }[];
      ordered.forEach((d, i) => setDocPosition.run(i, d.id));
    }
  }

  if (!hasColumn("generated_items", "position")) {
    database.exec("ALTER TABLE generated_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Backfill matching the previous created_at DESC display order (newest
    // first), scoped per folder.
    const folderIds = (
      database.prepare("SELECT DISTINCT folder_id FROM generated_items").all() as {
        folder_id: number;
      }[]
    ).map((r) => r.folder_id);
    const setItemPosition = database.prepare(
      "UPDATE generated_items SET position = ? WHERE id = ?"
    );
    for (const folderId of folderIds) {
      const ordered = database
        .prepare("SELECT id FROM generated_items WHERE folder_id = ? ORDER BY created_at DESC")
        .all(folderId) as { id: number }[];
      ordered.forEach((item, i) => setItemPosition.run(i, item.id));
    }
  }

  if (!hasColumn("app_settings", "google_client_id")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN google_client_id TEXT");
  }
  if (!hasColumn("app_settings", "google_client_secret")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN google_client_secret TEXT");
  }
  if (!hasColumn("app_settings", "google_access_token")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN google_access_token TEXT");
  }
  if (!hasColumn("app_settings", "google_refresh_token")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN google_refresh_token TEXT");
  }
  if (!hasColumn("app_settings", "google_token_expiry")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN google_token_expiry TEXT");
  }
  if (!hasColumn("app_settings", "home_widgets")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN home_widgets TEXT");
  }
}

function createConnection(): Database.Database {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(fs.readFileSync(schemaPath, "utf-8"));
  migrate(database);
  return database;
}

// Reused across hot-reloads in dev so we don't reopen/re-migrate on every request.
const connection = globalThis.__studyBuddySqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") {
  globalThis.__studyBuddySqlite = connection;
}

export const sqliteDb = drizzle(connection, { schema });
