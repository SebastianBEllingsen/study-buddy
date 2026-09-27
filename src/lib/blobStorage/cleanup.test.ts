import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/models", () => ({ isBlobUrlReferenced: vi.fn(), isImageUrlReferenced: vi.fn() }));
vi.mock("./index", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return { ...actual, removeBlobByUrl: vi.fn() };
});

const { blobUrlsIn } = await import("./cleanup");

describe("blobUrlsIn", () => {
  it("finds this app's media URLs in stored JSON, and nothing else", () => {
    const json = JSON.stringify({
      cards: [
        { front: "Q", media: [{ type: "image", src: "/api/blobs/anki/1f2e.png" }] },
        { front: "see https://example.com/page", media: [{ type: "audio", src: "/api/blobs/anki/aa.mp3" }] },
      ],
      answers: [{ images: ["/api/blobs/anki/1f2e.png"] }],
    });
    expect(blobUrlsIn(json).sort()).toEqual(["/api/blobs/anki/1f2e.png", "/api/blobs/anki/aa.mp3"]);
  });
});
