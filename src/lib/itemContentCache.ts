import { inArray } from "drizzle-orm";
import { db, generated_items } from "./db";

// Generated items' content_json, kept in memory between requests. The
// dashboard stats and the review queue need every deck's and quiz's full
// content on each load, which on Supabase meant downloading all of it every
// time; now only items that changed since (by updated_at, which every
// content write bumps — see updateGeneratedItemContent) are fetched again.
// On globalThis so a dev hot-reload keeps it.

declare global {
  var __studyBuddyItemContent: Map<number, { updatedAt: string; contentJson: string }> | undefined;
}

const cache = (globalThis.__studyBuddyItemContent ??= new Map());

export function forgetItemContent(id: number): void {
  cache.delete(id);
}

// content_json for each row, from memory where it's current.
export async function itemContents(rows: { id: number; updated_at: string }[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const missing: number[] = [];
  for (const row of rows) {
    const cached = cache.get(row.id);
    if (cached && cached.updatedAt === row.updated_at) result.set(row.id, cached.contentJson);
    else missing.push(row.id);
  }
  if (missing.length > 0) {
    const fetched = await db
      .select({ id: generated_items.id, content_json: generated_items.content_json, updated_at: generated_items.updated_at })
      .from(generated_items)
      .where(inArray(generated_items.id, missing));
    for (const row of fetched) {
      cache.set(row.id, { updatedAt: row.updated_at, contentJson: row.content_json });
      result.set(row.id, row.content_json);
    }
  }
  return result;
}
