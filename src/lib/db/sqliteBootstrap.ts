import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const schemaPath = path.join(process.cwd(), "src", "lib", "schema.sql");

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
export function migrate(database: Database.Database) {
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
  if (!hasColumn("app_settings", "image_ai_provider")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN image_ai_provider TEXT");
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

  if (!hasColumn("generated_items", "source_handpicked")) {
    // No way to reconstruct this retroactively (a pre-existing NULL
    // source_folder_id item could have been either pooled or hand-picked
    // across folders — see schema.sql) — default false treats existing
    // ambiguous items as pooled, i.e. preserves today's behavior for them;
    // only new hand-picked generations going forward get the new column.
    database.exec(
      "ALTER TABLE generated_items ADD COLUMN source_handpicked INTEGER NOT NULL DEFAULT 0"
    );
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
  // Same reasoning as idx_documents_folder_id above — both columns are
  // guaranteed to exist by this point (see the ALTER TABLEs earlier in this
  // function) but were never actually indexed, unlike generated_items'
  // course_id.
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_generated_items_folder_id ON generated_items(folder_id)"
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_generated_items_source_folder_id ON generated_items(source_folder_id)"
  );

  // A document/generated_item/note with folder_id NULL is filed directly on
  // the course page — a real, intended state (see DocumentRow's doc comment
  // in models.ts), not something needing a home conjured up for it.

  const backfillPositions = (courseId: number) => {
    const ordered = database
      .prepare("SELECT id FROM folders WHERE course_id = ? ORDER BY created_at ASC")
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

  // The "Unsorted" master folder concept is retired — anything filed there
  // now belongs directly on the course page instead (folder_id NULL). Runs
  // after the legacy tree-merge above (which still needs is_master to find
  // each tree's root, if this database is old enough to have gone through
  // it). Any real subfolder someone nested under a master folder is
  // preserved by un-nesting it to top level first, rather than letting
  // parent_folder_id's ON DELETE CASCADE take it down too; documents/
  // generated_items/notes.folder_id and generated_items.source_folder_id
  // all null out automatically via their own ON DELETE SET NULL once the
  // folder row itself is deleted (foreign_keys is ON — see db/sqlite.ts).
  if (hasColumn("folders", "is_master")) {
    const masterFolders = database
      .prepare("SELECT id FROM folders WHERE is_master = 1")
      .all() as { id: number }[];
    const unnestSubfolders = database.prepare(
      "UPDATE folders SET parent_folder_id = NULL WHERE parent_folder_id = ?"
    );
    const deleteFolder = database.prepare("DELETE FROM folders WHERE id = ?");
    const dissolve = database.transaction((folderId: number) => {
      unnestSubfolders.run(folderId);
      deleteFolder.run(folderId);
    });
    for (const { id } of masterFolders) {
      dissolve(id);
    }
    try {
      database.exec("ALTER TABLE folders DROP COLUMN is_master");
    } catch (err) {
      // Non-fatal, same reasoning as the `tree` column drop above.
      console.warn("Could not drop folders.is_master column:", err);
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
  if (!hasColumn("courses", "show_practice")) {
    database.exec("ALTER TABLE courses ADD COLUMN show_practice INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn("courses", "folder_chips")) {
    database.exec("ALTER TABLE courses ADD COLUMN folder_chips TEXT");
  }
  // A big, Steam-library-style backdrop behind the whole course page —
  // deliberately a separate field from cover_image (the small header
  // banner): a good banner crop (wide, short) and a good full-page
  // background crop (tall, atmospheric) are rarely the same crop of the
  // same photo.
  if (!hasColumn("courses", "page_background_image")) {
    database.exec("ALTER TABLE courses ADD COLUMN page_background_image TEXT");
  }

  // Same emoji+accent-color customization as courses, one level down.
  if (!hasColumn("folders", "icon")) {
    database.exec("ALTER TABLE folders ADD COLUMN icon TEXT");
  }
  if (!hasColumn("folders", "color")) {
    database.exec("ALTER TABLE folders ADD COLUMN color TEXT");
  }

  if (!hasColumn("calendar_feeds", "show_on_calendar")) {
    database.exec("ALTER TABLE calendar_feeds ADD COLUMN show_on_calendar INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn("calendar_feeds", "show_in_widget")) {
    database.exec("ALTER TABLE calendar_feeds ADD COLUMN show_in_widget INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn("calendar_feeds", "enabled")) {
    database.exec("ALTER TABLE calendar_feeds ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
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
  if (!hasColumn("notes", "icon")) {
    database.exec("ALTER TABLE notes ADD COLUMN icon TEXT");
  }
  // Safe to run every startup — column is guaranteed to exist by this
  // point, whether from a fresh schema.sql or the ALTER TABLEs just above.
  database.exec("CREATE INDEX IF NOT EXISTS idx_notes_course_id ON notes(course_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_notes_folder_id ON notes(folder_id)");

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
  if (!hasColumn("app_settings", "auto_open_generated_items")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN auto_open_generated_items INTEGER NOT NULL DEFAULT 1"
    );
  }
  // App-wide rebrand: a custom name/icon (emoji and/or an uploaded image —
  // same icon/icon_image split as course customization, see courses above)
  // and a font pick independent of the appearance theme, so "which theme"
  // and "which font" are two separate axes instead of the font being baked
  // into the theme choice. All null = the built-in "Study Buddy" defaults.
  if (!hasColumn("app_settings", "app_name")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN app_name TEXT");
  }
  if (!hasColumn("app_settings", "app_icon")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN app_icon TEXT");
  }
  if (!hasColumn("app_settings", "app_icon_image")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN app_icon_image TEXT");
  }
  if (!hasColumn("app_settings", "app_font")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN app_font TEXT");
  }
  // Same Steam-library-style full-page backdrop as a course page, applied
  // to the home dashboard instead — see courses.page_background_image.
  if (!hasColumn("app_settings", "dashboard_background_image")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN dashboard_background_image TEXT");
  }
  if (!hasColumn("app_settings", "dashboard_banner_style")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN dashboard_banner_style TEXT");
  }
  if (!hasColumn("app_settings", "ai_grading_enabled")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN ai_grading_enabled INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("app_settings", "dashboard_transparent_widgets")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN dashboard_transparent_widgets INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("app_settings", "dashboard_lock_background_crop")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN dashboard_lock_background_crop INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("app_settings", "dashboard_backdrop_full_page")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN dashboard_backdrop_full_page INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("app_settings", "unlimited_uploads")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN unlimited_uploads INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn("app_settings", "document_badges_enabled")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN document_badges_enabled INTEGER NOT NULL DEFAULT 1"
    );
  }
  if (!hasColumn("app_settings", "document_badge_detail")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN document_badge_detail TEXT");
  }
  if (!hasColumn("app_settings", "folder_chips")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN folder_chips TEXT");
  }
  if (!hasColumn("app_settings", "app_wallpaper")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN app_wallpaper TEXT");
  }
  if (!hasColumn("app_settings", "ai_efficiency_mode")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN ai_efficiency_mode INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("app_settings", "model_badge_detail")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN model_badge_detail TEXT");
  }
  if (!hasColumn("app_settings", "ai_enabled")) {
    database.exec("ALTER TABLE app_settings ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn("app_settings", "cli_trusted_mode_enabled")) {
    database.exec(
      "ALTER TABLE app_settings ADD COLUMN cli_trusted_mode_enabled INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasColumn("chat_messages", "attachments")) {
    database.exec("ALTER TABLE chat_messages ADD COLUMN attachments TEXT");
  }
  if (!hasColumn("chat_conversations", "course_id")) {
    database.exec(
      "ALTER TABLE chat_conversations ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL"
    );
  }
  if (!hasColumn("chat_messages", "pending_action")) {
    database.exec("ALTER TABLE chat_messages ADD COLUMN pending_action TEXT");
  }
}

// Applies schema.sql then migrate() — the full bootstrap sequence any
// SQLite connection (the real data/study_buddy.db file, or a throwaway
// in-memory database for tests — see db/testHarness.ts) needs to reach the
// current schema shape. No side effects of its own beyond acting on
// whatever `database` it's given.
export function bootstrapSqliteDatabase(database: Database.Database): void {
  database.exec(fs.readFileSync(schemaPath, "utf-8"));
  migrate(database);
}
