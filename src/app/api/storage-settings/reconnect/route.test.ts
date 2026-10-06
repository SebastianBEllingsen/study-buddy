import { beforeEach, describe, expect, it, vi } from "vitest";

const reconnect = vi.fn();
const reconnectBlobStorage = vi.fn();
vi.mock("@/lib/db", () => ({ reconnect: (...a: unknown[]) => reconnect(...a) }));
vi.mock("@/lib/blobStorage", () => ({ reconnectBlobStorage: (...a: unknown[]) => reconnectBlobStorage(...a) }));

const { POST } = await import("./route");

beforeEach(() => {
  reconnect.mockReset();
  reconnectBlobStorage.mockReset();
});

describe("POST /api/storage-settings/reconnect", () => {
  it("reconnects with the saved settings and says it worked", async () => {
    reconnect.mockResolvedValue({ ok: true, error: null });
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true, error: null });
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(reconnectBlobStorage).toHaveBeenCalledTimes(1);
  });

  it("passes on why it still can't connect", async () => {
    reconnect.mockResolvedValue({ ok: false, error: "connection refused" });
    expect(await (await POST()).json()).toEqual({ ok: false, error: "connection refused" });
  });
});
