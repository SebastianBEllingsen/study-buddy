import { describe, expect, it } from "vitest";
import { parseYouTubeTimestamp, youTubeEmbedUrl, youTubePlaylistId, youTubeVideoId } from "./youtube";

const EMBED = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

describe("youTubeEmbedUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "  https://youtu.be/dQw4w9WgXcQ  ",
  ])("recognizes %s", (url) => {
    expect(youTubeEmbedUrl(url)).toBe(EMBED);
  });

  it("carries the start time across", () => {
    expect(youTubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(`${EMBED}?start=90`);
    expect(youTubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toBe(`${EMBED}?start=90`);
  });

  it.each([
    "https://www.youtube.com/",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "studybuddy-image:3",
    "not a url",
  ])("rejects %s", (url) => {
    expect(youTubeEmbedUrl(url)).toBeNull();
  });
});

describe("parseYouTubeTimestamp", () => {
  it("parses seconds and h/m/s forms", () => {
    expect(parseYouTubeTimestamp("42")).toBe(42);
    expect(parseYouTubeTimestamp("42s")).toBe(42);
    expect(parseYouTubeTimestamp("1h2m3s")).toBe(3723);
    expect(parseYouTubeTimestamp("2m")).toBe(120);
  });

  it("returns null for missing or malformed values", () => {
    expect(parseYouTubeTimestamp(null)).toBeNull();
    expect(parseYouTubeTimestamp("")).toBeNull();
    expect(parseYouTubeTimestamp("abc")).toBeNull();
  });
});

describe("youTubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=5", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("reads the id from %s", (url, id) => {
    expect(youTubeVideoId(url)).toBe(id);
  });

  it.each(["https://www.youtube.com/playlist?list=PL1234567890ab", "https://example.com/watch?v=dQw4w9WgXcQ", "nope"])(
    "returns null for %s",
    (url) => {
      expect(youTubeVideoId(url)).toBeNull();
    }
  );
});

describe("youTubePlaylistId", () => {
  it("reads a playlist page's list id", () => {
    expect(youTubePlaylistId("https://www.youtube.com/playlist?list=PLabcdefghij123")).toBe("PLabcdefghij123");
  });

  it("reads the list id off a watch URL that carries one", () => {
    expect(youTubePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij123")).toBe(
      "PLabcdefghij123"
    );
  });

  it("returns null without a list, or off YouTube", () => {
    expect(youTubePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youTubePlaylistId("https://example.com/playlist?list=PLabcdefghij123")).toBeNull();
  });
});
