import { sql } from "drizzle-orm";
import { ID_RANGE } from "./ids";
import { syncTables } from "./tables";

// The cloud (Postgres) half of sync: a change log filled by triggers on
// every table — including changes made by computers in plain Supabase mode
// — which each computer pulls from, skipping its own changes (tagged with
// its device id for the transaction), and a registry of computers.

// A Drizzle Postgres database (postgres-js in the app, PGlite in tests).
export interface CloudDb {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
  transaction: <T>(fn: (tx: CloudDb) => Promise<T>) => Promise<T>;
}

// postgres-js returns rows as an array, PGlite as { rows }.
export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

// Set per statement by a pushing computer: which computer made the change,
// and when it was actually made (it may have waited offline for a while),
// so conflicts compare edit times, not upload times.
const DEVICE = "nullif(current_setting('study_buddy.device', true), '')";
const CHANGED_AT = "coalesce(nullif(current_setting('study_buddy.changed_at', true), '')::timestamptz, now())";

// Idempotent — runs on every sync set-up, so tables added later get their
// trigger too.
export async function ensureCloudSync(db: CloudDb): Promise<void> {
  await db.execute(sql`
    create table if not exists sync_changes (
      seq bigserial primary key,
      table_name text not null,
      row_key text not null,
      device text,
      changed_at timestamptz not null default now()
    )`);
  await db.execute(sql`create index if not exists idx_sync_changes_changed_at on sync_changes (changed_at)`);
  await db.execute(sql`
    create table if not exists sync_devices (
      id text primary key,
      name text not null,
      id_base integer not null unique,
      created_at timestamptz not null default now(),
      last_push timestamptz,
      last_pull timestamptz
    )`);
  await db.execute(sql`create table if not exists sync_meta (key text primary key, value text not null)`);
  // Triggers and constraint changes lock each table briefly: all in one
  // transaction, and giving up quickly rather than hanging if something
  // else holds a lock.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    for (const table of syncTables()) {
      const keyExpr = (row: "NEW" | "OLD") =>
        `json_build_array(${table.key.map((c) => `${row}."${c}"`).join(", ")})::text`;
      // One function per table: the key columns differ.
      await tx.execute(
        sql.raw(`
        create or replace function "sync_log_${table.name}"() returns trigger language plpgsql as $$
        begin
          if tg_op = 'DELETE' or (tg_op = 'UPDATE' and ${keyExpr("OLD")} <> ${keyExpr("NEW")}) then
            insert into sync_changes (table_name, row_key, device, changed_at)
            values ('${table.name}', ${keyExpr("OLD")}, ${DEVICE}, ${CHANGED_AT});
          end if;
          if tg_op <> 'DELETE' then
            insert into sync_changes (table_name, row_key, device, changed_at)
            values ('${table.name}', ${keyExpr("NEW")}, ${DEVICE}, ${CHANGED_AT});
          end if;
          return null;
        end $$`)
      );
      await tx.execute(
        sql.raw(`create or replace trigger "sync_log" after insert or update or delete on "${table.name}"
          for each row execute function "sync_log_${table.name}"()`)
      );
    }
    // Pushing sends a batch of rows in change order, which can put a child
    // before its parent — checked at commit instead, when all are there.
    const fks = rowsOf<{ table_name: string; conname: string }>(
      await tx.execute(sql`
        select c.conrelid::regclass::text as table_name, c.conname
        from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace and not c.condeferrable`)
    );
    for (const fk of fks) {
      await tx.execute(sql.raw(`alter table ${fk.table_name} alter constraint "${fk.conname}" deferrable initially immediate`));
    }
  });
}

export interface Device {
  id: string;
  idBase: number;
}

// Registers this computer, giving it the next free id range.
export async function registerDevice(db: CloudDb, id: string, name: string): Promise<Device> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table sync_devices in exclusive mode`);
    const existing = rowsOf<{ id_base: number }>(await tx.execute(sql`select id_base from sync_devices where id = ${id}`));
    if (existing[0]) return { id, idBase: Number(existing[0].id_base) };
    const [row] = rowsOf<{ max: number | null }>(await tx.execute(sql`select max(id_base) as max from sync_devices`));
    const idBase = Number(row?.max ?? 0) + ID_RANGE;
    await tx.execute(sql`insert into sync_devices (id, name, id_base) values (${id}, ${name}, ${idBase})`);
    return { id, idBase };
  });
}

export async function latestChangeSeq(db: CloudDb): Promise<number> {
  const [row] = rowsOf<{ seq: string | null }>(await db.execute(sql`select max(seq) as seq from sync_changes`));
  return Number(row?.seq ?? 0);
}

export interface CloudChange {
  seq: number;
  table_name: string;
  row_key: string;
  device: string | null;
  changed_at: string;
}

export async function changesSince(db: CloudDb, seq: number, limit = 5000): Promise<CloudChange[]> {
  return rowsOf<CloudChange>(
    await db.execute(sql`
      select seq::text as seq, table_name, row_key, device,
        to_char(changed_at at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.MS') as changed_at
      from sync_changes where seq > ${seq} order by seq limit ${limit}`)
  ).map((c) => ({ ...c, seq: Number(c.seq) }));
}

// Change log entries older than this are dropped; a computer that hasn't
// synced since gets a full refresh instead (see prunedBefore).
const KEEP_CHANGES_DAYS = 60;

export async function pruneChanges(db: CloudDb): Promise<void> {
  const [row] = rowsOf<{ seq: string | null }>(
    await db.execute(sql`
      delete from sync_changes where changed_at < now() - make_interval(days => ${KEEP_CHANGES_DAYS})
      returning seq`)
  ).sort((a, b) => Number(b.seq) - Number(a.seq));
  if (row?.seq) {
    await db.execute(sql`
      insert into sync_meta (key, value) values ('pruned_through', ${row.seq})
      on conflict (key) do update set value = greatest(sync_meta.value::bigint, excluded.value::bigint)::text`);
  }
}

// Changes up to this seq may have been dropped from the log.
export async function prunedThrough(db: CloudDb): Promise<number> {
  const [row] = rowsOf<{ value: string }>(await db.execute(sql`select value from sync_meta where key = 'pruned_through'`));
  return Number(row?.value ?? 0);
}

export async function touchDevice(db: CloudDb, id: string, what: "push" | "pull"): Promise<void> {
  await db.execute(what === "push" ? sql`update sync_devices set last_push = now() where id = ${id}` : sql`update sync_devices set last_pull = now() where id = ${id}`);
}
