import { describe, it, expect, vi, beforeEach } from "vitest";

const put = vi.fn();
let store: { put: typeof put } | null = { put };
vi.mock("@/lib/blobStorage", () => ({
  get blobStore() {
    return store;
  },
}));

const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({ getAppSettings: () => getAppSettings() }));

const { POST } = await import("./route");

function upload(kind: string, bytes: number, type = "image/gif"): Request {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", new File([new Uint8Array(bytes)], "x", { type }));
  return new Request("http://localhost/api/blobs", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  store = { put };
  put.mockResolvedValue({ url: "/api/blobs/note/x.gif" });
  getAppSettings.mockResolvedValue({ unlimitedUploads: false });
});

describe("POST /api/blobs size limits", () => {
  it("rejects a file over its kind's cap, saying what the cap is", async () => {
    const res = await POST(upload("icon", 3_000_001));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Image is too large (max 3 MB)");
    expect(put).not.toHaveBeenCalled();
  });

  it("accepts a file within the cap", async () => {
    const res = await POST(upload("note", 1_000));
    expect(await res.json()).toEqual({ url: "/api/blobs/note/x.gif" });
  });

  it("lifts the cap entirely with full-resolution uploads on", async () => {
    getAppSettings.mockResolvedValue({ unlimitedUploads: true });
    const res = await POST(upload("icon", 5_000_000));
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalled();
  });

  it("falls back to a data URL only for files within the normal cap", async () => {
    put.mockResolvedValue(null);
    const small = await POST(upload("note", 100));
    expect((await small.json()).dataUrl).toMatch(/^data:image\/gif;base64,/);

    getAppSettings.mockResolvedValue({ unlimitedUploads: true });
    const large = await POST(upload("note", 9_000_000));
    expect(large.status).toBe(502);
    expect((await large.json()).error).toMatch(/per-file size limit/);
  });

  it("still rejects kinds and types it doesn't know", async () => {
    expect((await POST(upload("wallpaper", 10))).status).toBe(400);
    expect((await POST(upload("note", 10, "image/svg+xml"))).status).toBe(400);
  });
});
