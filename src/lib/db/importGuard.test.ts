import { describe, it, expect } from "vitest";

// Verifies the structural guards in sqlite.ts and postgres.ts actually fire
// during a test run — these exist so that an accidental unmocked import of
// the real DB layer (e.g. a `vi.mock("./db", ...)` factory with a typo in
// the module path, or an `import type` that later gets turned into a real
// value import — see aiClient.test.ts/models.test.ts for the intentional
// mocking pattern these guards are the backstop for) fails loudly at import
// time instead of silently opening the real local database file or a real
// network connection using whatever's in data/storage-config.json. This
// deliberately does NOT mock either module — that's the whole point.
describe("DB layer import guards", () => {
  it("throws rather than opening the real database file when sqlite.ts is imported during a test", async () => {
    await expect(import("./sqlite")).rejects.toThrow(/must never be imported during tests/);
  });

  it("throws rather than opening a real network connection when createPostgresDb runs during a test", async () => {
    const { createPostgresDb } = await import("./postgres");
    await expect(createPostgresDb("postgres://fake")).rejects.toThrow(/must never run during tests/);
  });
});
