import { describe, it, expect } from "vitest";
import { stripEmbeddedImages, restoreEmbeddedImages, omitEmbeddedImages } from "./embeddedImages";

const DATA_URL = "data:image/png;base64,AAAA";

describe("stripEmbeddedImages", () => {
  it("replaces an embedded image with a numbered placeholder and returns the data URL", () => {
    const result = stripEmbeddedImages(`Before ![alt](${DATA_URL}) after`);
    expect(result.text).toBe("Before [[IMAGE_0]] after");
    expect(result.images).toEqual([DATA_URL]);
  });

  it("numbers multiple images in order of appearance", () => {
    const url2 = "data:image/jpeg;base64,BBBB";
    const result = stripEmbeddedImages(`![a](${DATA_URL}) text ![b](${url2})`);
    expect(result.text).toBe("[[IMAGE_0]] text [[IMAGE_1]]");
    expect(result.images).toEqual([DATA_URL, url2]);
  });

  it("leaves a regular (non-data-URL) markdown image untouched", () => {
    const result = stripEmbeddedImages("![alt](https://example.com/pic.png)");
    expect(result.text).toBe("![alt](https://example.com/pic.png)");
    expect(result.images).toEqual([]);
  });

  it("leaves plain text with no images untouched", () => {
    const result = stripEmbeddedImages("Nothing to see here.");
    expect(result.text).toBe("Nothing to see here.");
    expect(result.images).toEqual([]);
  });
});

describe("restoreEmbeddedImages", () => {
  it("puts the original data URL back in place of the placeholder", () => {
    const restored = restoreEmbeddedImages("Before [[IMAGE_0]] after", [DATA_URL]);
    expect(restored).toBe(`Before ${DATA_URL} after`);
  });

  it("restores multiple placeholders correctly, including out of textual order", () => {
    const url2 = "data:image/jpeg;base64,BBBB";
    const restored = restoreEmbeddedImages("[[IMAGE_1]] then [[IMAGE_0]]", [DATA_URL, url2]);
    expect(restored).toBe(`${url2} then ${DATA_URL}`);
  });

  it("leaves a placeholder untouched if its index is out of range", () => {
    const restored = restoreEmbeddedImages("[[IMAGE_5]]", [DATA_URL]);
    expect(restored).toBe("[[IMAGE_5]]");
  });

  it("round-trips through strip then restore", () => {
    const original = `Look: ![alt](${DATA_URL}) done`;
    const { text, images } = stripEmbeddedImages(original);
    expect(restoreEmbeddedImages(text, images)).toBe(`Look: ${DATA_URL} done`);
  });
});

describe("omitEmbeddedImages", () => {
  it("replaces an embedded image with a fixed [image] marker", () => {
    expect(omitEmbeddedImages(`Before ![alt](${DATA_URL}) after`)).toBe("Before [image] after");
  });

  it("replaces multiple images", () => {
    const url2 = "data:image/jpeg;base64,BBBB";
    expect(omitEmbeddedImages(`![a](${DATA_URL}) and ![b](${url2})`)).toBe("[image] and [image]");
  });

  it("leaves text with no embedded images untouched", () => {
    expect(omitEmbeddedImages("Nothing to see here.")).toBe("Nothing to see here.");
  });
});
