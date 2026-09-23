import { describe, it, expect } from "vitest";
import { isSafeCardMediaSrc, isValidCardMediaList } from "./cardMedia";

describe("isSafeCardMediaSrc", () => {
  it("allows http(s), this app's blob route, and data: URLs of the matching kind", () => {
    expect(isSafeCardMediaSrc("https://x.test/video/clip.mp4", "video")).toBe(true);
    expect(isSafeCardMediaSrc("http://example.com/a.png", "image")).toBe(true);
    expect(isSafeCardMediaSrc("/api/blobs/anki/x.mp3", "audio")).toBe(true);
    expect(isSafeCardMediaSrc("data:image/png;base64,AAAA", "image")).toBe(true);
  });

  it("refuses script/file schemes, mismatched data: kinds, relative paths and traversal", () => {
    expect(isSafeCardMediaSrc("javascript:alert(1)", "image")).toBe(false);
    expect(isSafeCardMediaSrc("file:///etc/passwd", "image")).toBe(false);
    expect(isSafeCardMediaSrc("data:text/html,<script>", "image")).toBe(false);
    expect(isSafeCardMediaSrc("data:image/png;base64,AAAA", "video")).toBe(false);
    expect(isSafeCardMediaSrc("pic.png", "image")).toBe(false);
    expect(isSafeCardMediaSrc("/api/blobs/../secret", "image")).toBe(false);
  });
});

describe("isValidCardMediaList", () => {
  it("accepts a list of well-formed, safe entries", () => {
    expect(isValidCardMediaList([{ type: "video", src: "https://x.test/v.mp4" }])).toBe(true);
    expect(isValidCardMediaList([])).toBe(true);
  });

  it("rejects wrong shapes, unknown types and unsafe sources", () => {
    expect(isValidCardMediaList("nope")).toBe(false);
    expect(isValidCardMediaList([{ type: "pdf", src: "https://x.test/a.pdf" }])).toBe(false);
    expect(isValidCardMediaList([{ type: "image" }])).toBe(false);
    expect(isValidCardMediaList([{ type: "image", src: "javascript:x" }])).toBe(false);
  });
});
