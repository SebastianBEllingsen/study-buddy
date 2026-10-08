import { describe, it, expect, vi, beforeEach } from "vitest";

const getDayTotals = vi.fn();
const recordFinishedToday = vi.fn();
vi.mock("@/lib/today/finished", async () => {
  const actual = await vi.importActual<typeof import("@/lib/today/finished")>("@/lib/today/finished");
  return { ...actual, getDayTotals: (...a: unknown[]) => getDayTotals(...a), recordFinishedToday: (...a: unknown[]) => recordFinishedToday(...a) };
});
vi.mock("@/lib/db", () => ({}));

const { GET, POST } = await import("./route");

const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  getDayTotals.mockResolvedValue(null);
  recordFinishedToday.mockResolvedValue(undefined);
});

describe("/api/today/finished", () => {
  it("reads a day's totals", async () => {
    getDayTotals.mockResolvedValue({ date: "2026-10-06", sessions: 1, steps: 2, focusMs: 5 });
    const res = await GET(new Request("http://localhost/x?date=2026-10-06"));
    expect(await res.json()).toEqual({ totals: { date: "2026-10-06", sessions: 1, steps: 2, focusMs: 5 } });
  });

  it("turns away a missing or malformed date", async () => {
    expect((await GET(new Request("http://localhost/x"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/x?date=today"))).status).toBe(400);
  });

  it("records a finished session", async () => {
    expect((await POST(post({ date: "2026-10-06", steps: 2, focusMs: 5 }))).status).toBe(200);
    expect(recordFinishedToday).toHaveBeenCalledWith({ date: "2026-10-06", steps: 2, focusMs: 5 });
  });

  it("rejects bad bodies and reports save failures", async () => {
    for (const body of ["nope", "[1]", {}, { date: "2026-10-06", steps: -1, focusMs: 0 }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(recordFinishedToday).not.toHaveBeenCalled();
    recordFinishedToday.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(post({ date: "2026-10-06", steps: 2, focusMs: 5 }))).status).toBe(500);
  });
});
