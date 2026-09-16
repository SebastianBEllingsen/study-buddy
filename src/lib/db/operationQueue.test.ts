import { describe, it, expect } from "vitest";
import { enqueue } from "./operationQueue";

// This is the actual production FIFO queue db/index.ts's runTransaction and
// reconnect() both go through (see that file's own comment on why a
// reconnect() needs to share it) — imported directly here rather than via
// db/index.ts, since that module resolves a real database connection at
// import time (see its top-level `await resolve(...)`) and this suite's
// import guards (see importGuard.test.ts) deliberately refuse to let that
// happen during a test run. testHarness.ts's own runTransaction reuses this
// same function for the same reason: a test exercising serialization
// through the in-memory test harness should prove the real queue works,
// not a parallel reimplementation of it.

describe("enqueue", () => {
  it("runs callbacks in FIFO order, never interleaved", async () => {
    const order: number[] = [];
    const active = { count: 0, max: 0 };

    async function op(id: number, delayMs: number) {
      return enqueue(async () => {
        active.count++;
        active.max = Math.max(active.max, active.count);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(id);
        active.count--;
      });
    }

    // Enqueued out of delay order — op 1 is the slowest, so without real
    // serialization op 2/3 would finish (and record) before it.
    await Promise.all([op(1, 30), op(2, 10), op(3, 0)]);

    expect(order).toEqual([1, 2, 3]);
    expect(active.max).toBe(1); // never more than one callback in flight at once
  });

  it("lets the queue continue after a callback throws, rather than jamming it", async () => {
    const results: string[] = [];

    const failing = enqueue(async () => {
      throw new Error("boom");
    });
    const after = enqueue(async () => {
      results.push("ran");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ok");
    expect(results).toEqual(["ran"]);
  });

  it("propagates each callback's own return value to its own caller", async () => {
    const [a, b] = await Promise.all([enqueue(async () => "a"), enqueue(async () => "b")]);
    expect(a).toBe("a");
    expect(b).toBe("b");
  });

  it("does not start the next callback until the previous one's promise settles", async () => {
    let secondStarted = false;
    let resolveFirst!: () => void;

    const first = enqueue(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const second = enqueue(async () => {
      secondStarted = true;
    });

    // Give any (incorrect) immediate scheduling a chance to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(secondStarted).toBe(false);

    resolveFirst();
    await first;
    await second;
    expect(secondStarted).toBe(true);
  });
});
