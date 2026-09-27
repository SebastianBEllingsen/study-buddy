import type Database from "better-sqlite3";
import { getTableName, type Table } from "drizzle-orm";
import { syncTables } from "./tables";

// In sync mode every computer creates rows with ids from its own range
// (device N: N × 100,000,000 onwards), so two computers working apart can
// never both create, say, course 42. SQLite's own AUTOINCREMENT can't do
// this — it always continues after the highest id in the table, which after
// pulling another computer's rows is inside *their* range — so ids are
// handed out here instead, by wrapping the app's database handle so every
// insert that doesn't set an id gets the next one from this range.

export const ID_RANGE = 100_000_000;

export class IdAllocator {
  private next = new Map<string, number>();

  constructor(
    private conn: Database.Database,
    private base: number
  ) {}

  // Forget cached counters (after pulling or replacing rows).
  reset(): void {
    this.next.clear();
  }

  allocate(table: string): number {
    let id = this.next.get(table);
    if (id === undefined) {
      const row = this.conn
        .prepare(`SELECT max(id) AS max FROM "${table}" WHERE id >= ? AND id < ?`)
        .get(this.base, this.base + ID_RANGE) as { max: number | null };
      id = (row.max ?? this.base) + 1;
    }
    if (id >= this.base + ID_RANGE) throw new Error(`This computer has used up its id range for ${table}`);
    this.next.set(table, id + 1);
    return id;
  }
}

const AUTO_ID_TABLES = () => new Set(syncTables().filter((t) => t.autoId).map((t) => t.name));

function withIds(rows: unknown, table: string, ids: IdAllocator): unknown {
  const fill = (row: Record<string, unknown>) => (row.id === undefined || row.id === null ? { ...row, id: ids.allocate(table) } : row);
  return Array.isArray(rows) ? rows.map((r) => fill(r as Record<string, unknown>)) : fill(rows as Record<string, unknown>);
}

// Wraps a Drizzle database (and the transactions it opens) so inserts get
// ids from `ids`. Everything else passes straight through.
export function withDeviceIds<T extends object>(db: T, ids: IdAllocator): T {
  const autoIdTables = AUTO_ID_TABLES();
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (prop === "insert" && typeof value === "function") {
          return (table: Table) => {
            const builder = value.call(obj, table);
            const name = getTableName(table);
            if (!autoIdTables.has(name)) return builder;
            const values = builder.values.bind(builder);
            builder.values = (rows: unknown) => values(withIds(rows, name, ids));
            return builder;
          };
        }
        if (prop === "transaction" && typeof value === "function") {
          return (fn: (tx: object) => unknown, ...rest: unknown[]) =>
            value.call(obj, (tx: object) => fn(wrap(tx)), ...rest);
        }
        return typeof value === "function" ? value.bind(obj) : value;
      },
    });
  return wrap(db) as T;
}
