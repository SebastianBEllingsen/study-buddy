import fs from "node:fs/promises";
import { sql } from "drizzle-orm";
import { sqliteDb } from "@/lib/db/sqlite";
import * as sqliteSchema from "@/lib/db/schema.sqlite";
import * as pgSchema from "@/lib/db/schema.pg";
import { createPostgresDb, type PostgresDb } from "@/lib/db/postgres";

// One-time copy of the local SQLite database into a Postgres (Supabase)
// database — always local-file -> connectionString, regardless of which
// backend happens to be active right now, since this exists specifically to
// seed a new cloud database from existing local data. Does not touch
// data/storage-config.json: switching the active mode is a separate,
// explicit save (see ../route.ts's POST) so a failed or partial migration
// never leaves the app pointed at an empty cloud database.
//
// Every insert below is actually an upsert (onConflictDoUpdate by primary
// key) so this is safe to run again later — e.g. after adding more courses
// locally, or re-syncing from a second machine that's fallen behind. Rows
// that already exist in Postgres get overwritten with the local version;
// new rows get inserted. This is a one-way "local wins" push, not a merge —
// running it from a machine with older data would overwrite newer cloud
// rows with stale local ones, so only run it from whichever machine has the
// data you want to keep.

// Postgres text columns reject the NUL byte ("\0") outright — SQLite has
// no such restriction, so old rows extracted before extraction.ts started
// stripping NULs (or any other latent bad data) can sit in the local DB for
// years without issue, then abort an entire migration insert the moment
// they're copied to Postgres. Strip NULs from every string field on every
// row defensively here, rather than trusting the source data is clean.
function stripNulBytes<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const cleaned = { ...row };
    for (const key of Object.keys(cleaned)) {
      const value = cleaned[key];
      if (typeof value === "string" && value.includes("\0")) {
        (cleaned as Record<string, unknown>)[key] = value.replace(/\0/g, "");
      }
    }
    return cleaned;
  });
}

// Builds the `set` clause for an upsert: every column except the conflict
// target(s), pointed at Postgres's `excluded` pseudo-table (the row that
// was proposed for insertion) — the standard "upsert overwrites everything"
// pattern, without hand-listing each table's columns twice.
function upsertSet(columnNames: string[]) {
  const set: Record<string, ReturnType<typeof sql>> = {};
  for (const name of columnNames) {
    set[name] = sql.raw(`excluded.${name}`);
  }
  return set;
}

// Backfills file_base64 for documents uploaded before that column existed —
// reads the still-present local file, so previously-migrated libraries get
// PDF sync too, not just newly-uploaded documents. Best-effort: a document
// whose local file is also gone by now just stays without a synced PDF
// (falls back to extracted text when viewed).
async function backfillFileBase64<T extends { file_path: string; file_base64: string | null }>(
  rows: T[]
): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.file_base64) return row;
      try {
        const buffer = await fs.readFile(row.file_path);
        return { ...row, file_base64: buffer.toString("base64") };
      } catch {
        return row;
      }
    })
  );
}

async function resetSerialSequence(pgDb: PostgresDb, table: string, maxId: number) {
  // Explicit-PK inserts above leave the table's identity sequence at its
  // untouched starting point — bump it past the highest migrated id so the
  // next insert (with no explicit id) picks a fresh one instead of colliding.
  await pgDb.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}', 'id'), ${maxId})`));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const connectionString =
    typeof body?.connectionString === "string" ? body.connectionString.trim() : "";
  if (!connectionString) {
    return Response.json({ error: "connectionString is required" }, { status: 400 });
  }

  let pgDb: PostgresDb;
  let client: Awaited<ReturnType<typeof createPostgresDb>>["client"];
  try {
    ({ db: pgDb, client } = await createPostgresDb(connectionString));
  } catch (err) {
    return Response.json(
      {
        error: `Couldn't connect to that database: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 }
    );
  }

  // This connection is only for the duration of this one migration — always
  // close it afterward instead of leaking a pool per migrate click.
  try {
    return await runMigration(pgDb);
  } finally {
    await client.end();
  }
}

async function runMigration(pgDb: PostgresDb): Promise<Response> {
  try {
    // Parents before children, respecting foreign keys. Every table in
    // schema.sqlite.ts/schema.pg.ts is listed here — a table missing from
    // this list means it silently never leaves the local SQLite file, which
    // is exactly the bug this list exists to prevent (see git history).
    const [
      courseRows,
      folderRows,
      documentRows,
      itemRows,
      attemptRows,
      reviewRows,
      scheduleRows,
      notificationRows,
      noteRows,
      feedRows,
      completedAssignmentRows,
      recentViewRows,
      uploadedImageRows,
      conversationRows,
      messageRows,
      presetRows,
      settingsRows,
    ] = await Promise.all([
      sqliteDb.select().from(sqliteSchema.courses),
      sqliteDb.select().from(sqliteSchema.folders),
      sqliteDb.select().from(sqliteSchema.documents),
      sqliteDb.select().from(sqliteSchema.generated_items),
      sqliteDb.select().from(sqliteSchema.quiz_attempts),
      sqliteDb.select().from(sqliteSchema.flashcard_reviews),
      sqliteDb.select().from(sqliteSchema.flashcard_schedule),
      sqliteDb.select().from(sqliteSchema.generation_notifications),
      sqliteDb.select().from(sqliteSchema.notes),
      sqliteDb.select().from(sqliteSchema.calendar_feeds),
      sqliteDb.select().from(sqliteSchema.completed_assignments),
      sqliteDb.select().from(sqliteSchema.recent_views),
      sqliteDb.select().from(sqliteSchema.uploaded_images),
      sqliteDb.select().from(sqliteSchema.chat_conversations),
      sqliteDb.select().from(sqliteSchema.chat_messages),
      sqliteDb.select().from(sqliteSchema.quiz_generation_presets),
      sqliteDb.select().from(sqliteSchema.app_settings),
    ]);

    const documentRowsWithFiles = await backfillFileBase64(documentRows);

    if (courseRows.length > 0) {
      await pgDb
        .insert(pgSchema.courses)
        .values(stripNulBytes(courseRows))
        .onConflictDoUpdate({
          target: pgSchema.courses.id,
          set: upsertSet([
            "name",
            "position",
            "icon",
            "color",
            "cover_image",
            "icon_image",
            "show_cover_on_card",
            "show_icon_frame",
            "page_background_image",
            "created_at",
          ]),
        });
    }
    if (folderRows.length > 0) {
      await pgDb
        .insert(pgSchema.folders)
        .values(stripNulBytes(folderRows))
        .onConflictDoUpdate({
          target: pgSchema.folders.id,
          set: upsertSet([
            "course_id",
            "name",
            "position",
            "parent_folder_id",
            "icon",
            "color",
            "created_at",
          ]),
        });
    }
    if (documentRowsWithFiles.length > 0) {
      await pgDb
        .insert(pgSchema.documents)
        .values(stripNulBytes(documentRowsWithFiles))
        .onConflictDoUpdate({
          target: pgSchema.documents.id,
          set: upsertSet([
              "course_id",
              "folder_id",
              "position",
              "filename",
              "file_path",
              "file_base64",
              "extracted_text",
              "page_count",
              "char_count",
              "status",
              "error_message",
              "created_at",
            ]),
        });
    }
    if (itemRows.length > 0) {
      await pgDb
        .insert(pgSchema.generated_items)
        .values(stripNulBytes(itemRows))
        .onConflictDoUpdate({
          target: pgSchema.generated_items.id,
          set: upsertSet([
              "course_id",
              "folder_id",
              "position",
              "mode",
              "title",
              "content_json",
              "source_document_ids",
              "source_folder_id",
              "source_handpicked",
              "model_provider",
              "model_name",
              "created_at",
              "updated_at",
            ]),
        });
    }
    if (attemptRows.length > 0) {
      await pgDb
        .insert(pgSchema.quiz_attempts)
        .values(stripNulBytes(attemptRows))
        .onConflictDoUpdate({
          target: pgSchema.quiz_attempts.id,
          set: upsertSet(["generated_item_id", "started_at", "completed_at", "score", "answers_json"]),
        });
    }
    if (reviewRows.length > 0) {
      await pgDb
        .insert(pgSchema.flashcard_reviews)
        .values(stripNulBytes(reviewRows))
        .onConflictDoUpdate({
          target: pgSchema.flashcard_reviews.id,
          set: upsertSet(["generated_item_id", "card_index", "last_result", "reviewed_at"]),
        });
    }
    if (scheduleRows.length > 0) {
      await pgDb
        .insert(pgSchema.flashcard_schedule)
        .values(stripNulBytes(scheduleRows))
        .onConflictDoUpdate({
          target: [pgSchema.flashcard_schedule.generated_item_id, pgSchema.flashcard_schedule.card_index],
          set: upsertSet(["ease_factor", "interval_days", "repetitions", "due_at", "last_reviewed_at"]),
        });
    }
    if (notificationRows.length > 0) {
      await pgDb
        .insert(pgSchema.generation_notifications)
        .values(stripNulBytes(notificationRows))
        .onConflictDoUpdate({
          target: pgSchema.generation_notifications.generated_item_id,
          set: upsertSet(["created_at"]),
        });
    }
    if (noteRows.length > 0) {
      await pgDb
        .insert(pgSchema.notes)
        .values(stripNulBytes(noteRows))
        .onConflictDoUpdate({
          target: pgSchema.notes.id,
          set: upsertSet([
            "course_id",
            "folder_id",
            "position",
            "title",
            "markdown",
            "icon",
            "created_at",
            "updated_at",
          ]),
        });
    }
    if (feedRows.length > 0) {
      await pgDb
        .insert(pgSchema.calendar_feeds)
        .values(stripNulBytes(feedRows))
        .onConflictDoUpdate({
          target: pgSchema.calendar_feeds.id,
          set: upsertSet(["label", "url", "show_on_calendar", "show_in_widget", "enabled", "created_at"]),
        });
    }
    if (completedAssignmentRows.length > 0) {
      await pgDb
        .insert(pgSchema.completed_assignments)
        .values(stripNulBytes(completedAssignmentRows))
        .onConflictDoUpdate({
          target: pgSchema.completed_assignments.event_id,
          set: upsertSet(["completed_at"]),
        });
    }
    if (recentViewRows.length > 0) {
      await pgDb
        .insert(pgSchema.recent_views)
        .values(stripNulBytes(recentViewRows))
        .onConflictDoUpdate({
          target: [pgSchema.recent_views.item_type, pgSchema.recent_views.item_id],
          set: upsertSet(["viewed_at"]),
        });
    }
    if (uploadedImageRows.length > 0) {
      await pgDb
        .insert(pgSchema.uploaded_images)
        .values(stripNulBytes(uploadedImageRows))
        .onConflictDoUpdate({
          target: pgSchema.uploaded_images.id,
          set: upsertSet(["kind", "data_url", "created_at"]),
        });
    }
    if (conversationRows.length > 0) {
      await pgDb
        .insert(pgSchema.chat_conversations)
        .values(stripNulBytes(conversationRows))
        .onConflictDoUpdate({
          target: pgSchema.chat_conversations.id,
          set: upsertSet(["title", "created_at", "updated_at"]),
        });
    }
    if (messageRows.length > 0) {
      await pgDb
        .insert(pgSchema.chat_messages)
        .values(stripNulBytes(messageRows))
        .onConflictDoUpdate({
          target: pgSchema.chat_messages.id,
          set: upsertSet(["conversation_id", "role", "content", "created_at"]),
        });
    }
    if (presetRows.length > 0) {
      await pgDb
        .insert(pgSchema.quiz_generation_presets)
        .values(stripNulBytes(presetRows))
        .onConflictDoUpdate({
          target: pgSchema.quiz_generation_presets.id,
          set: upsertSet(["name", "single_choice", "multiple_choice", "short_answer", "created_at"]),
        });
    }
    if (settingsRows.length > 0) {
      await pgDb
        .insert(pgSchema.app_settings)
        .values(stripNulBytes(settingsRows))
        .onConflictDoUpdate({
          target: pgSchema.app_settings.id,
          set: upsertSet([
              "ai_provider",
              "image_ai_provider",
              "anthropic_api_key",
              "openai_api_key",
              "gemini_api_key",
              "openrouter_api_key",
              "show_model_badge",
              "google_client_id",
              "google_client_secret",
              "google_access_token",
              "google_refresh_token",
              "google_token_expiry",
              "home_widgets",
              "auto_open_generated_items",
              "app_name",
              "app_icon",
              "app_icon_image",
              "app_font",
              "dashboard_background_image",
              "dashboard_banner_style",
              "ai_grading_enabled",
              "dashboard_transparent_widgets",
              "document_badges_enabled",
              "document_badge_detail",
              "ai_efficiency_mode",
              "model_badge_detail",
              "ai_enabled",
              "updated_at",
            ]),
        });
    }

    const withSerialId: [string, { id: number }[]][] = [
      ["courses", courseRows],
      ["folders", folderRows],
      ["documents", documentRows],
      ["generated_items", itemRows],
      ["quiz_attempts", attemptRows],
      ["flashcard_reviews", reviewRows],
      ["notes", noteRows],
      ["calendar_feeds", feedRows],
      ["uploaded_images", uploadedImageRows],
      ["chat_conversations", conversationRows],
      ["chat_messages", messageRows],
      ["quiz_generation_presets", presetRows],
    ];
    for (const [table, rows] of withSerialId) {
      if (rows.length > 0) {
        await resetSerialSequence(pgDb, table, Math.max(...rows.map((r) => r.id)));
      }
    }

    return Response.json({
      ok: true,
      migrated: {
        courses: courseRows.length,
        folders: folderRows.length,
        documents: documentRows.length,
        generatedItems: itemRows.length,
        quizAttempts: attemptRows.length,
        flashcardReviews: reviewRows.length,
        flashcardSchedule: scheduleRows.length,
        generationNotifications: notificationRows.length,
        notes: noteRows.length,
        calendarFeeds: feedRows.length,
        completedAssignments: completedAssignmentRows.length,
        recentViews: recentViewRows.length,
        uploadedImages: uploadedImageRows.length,
        chatConversations: conversationRows.length,
        chatMessages: messageRows.length,
        quizGenerationPresets: presetRows.length,
      },
    });
  } catch (err) {
    return Response.json(
      { error: `Migration failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
