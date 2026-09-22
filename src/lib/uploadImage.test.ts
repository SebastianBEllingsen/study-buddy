import { describe, it, expect, vi, afterEach } from "vitest";
import { describeUploadError, ImageUploadError, uploadImage } from "./uploadImage";

afterEach(() => vi.unstubAllGlobals());

describe("uploadImage errors", () => {
  it("carries the server's own explanation for a rejected upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Image is too large (max 8 MB)" }), { status: 400 }))
    );
    const err = await uploadImage(new Blob(["x"], { type: "image/gif" }), "note").catch((e) => e);
    expect(err).toBeInstanceOf(ImageUploadError);
    expect(describeUploadError(err, "fallback")).toBe("Image is too large (max 8 MB)");
  });

  it("falls back to the caller's message for anything else", () => {
    expect(describeUploadError(new TypeError("Failed to fetch"), "Couldn't upload that image")).toBe(
      "Couldn't upload that image"
    );
  });
});
