import { describe, it, expect, vi, beforeEach } from "vitest";

const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({ getAppSettings: (...args: unknown[]) => getAppSettings(...args) }));

const { GET } = await import("./route");

function req(url = "http://localhost:3000/api/app-icon"): Request {
  return new Request(url);
}

beforeEach(() => {
  getAppSettings.mockReset();
});

describe("GET /api/app-icon", () => {
  it("serves an inline data: URL icon directly as bytes", async () => {
    getAppSettings.mockResolvedValue({ appIconImage: "data:image/png;base64,AAAA", appIcon: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  // Regression coverage: local blob storage hands back a relative URL
  // (/api/blobs/...) and Response.redirect() throws a TypeError on a
  // relative URL — every page load hit this whenever a custom app icon was
  // stored via local blob storage (the default storage mode).
  it("redirects to a relative blob-storage URL without throwing", async () => {
    getAppSettings.mockResolvedValue({ appIconImage: "/api/blobs/icon/abc123.png", appIcon: null });
    const res = await GET(req("http://localhost:3000/api/app-icon"));
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/api/blobs/icon/abc123.png");
  });

  it("redirects to an absolute Supabase Storage URL unchanged", async () => {
    const absolute = "https://project.supabase.co/storage/v1/object/public/files/icon/abc.png";
    getAppSettings.mockResolvedValue({ appIconImage: absolute, appIcon: null });
    const res = await GET(req());
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe(absolute);
  });

  it("renders an emoji favicon when no image is set", async () => {
    getAppSettings.mockResolvedValue({ appIconImage: null, appIcon: "📘" });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("📘");
  });

  it("falls back to the static favicon when nothing is configured", async () => {
    getAppSettings.mockResolvedValue({ appIconImage: null, appIcon: null });
    const res = await GET(req("http://localhost:3000/api/app-icon"));
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/favicon.ico");
  });
});
