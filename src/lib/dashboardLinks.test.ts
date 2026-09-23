import { describe, expect, it } from "vitest";
import {
  brandKeyForUrl,
  droppedLinkIconImages,
  normalizeDashboardLinks,
  normalizeLinkUrl,
  parseDashboardLinks,
} from "./dashboardLinks";
import { LINK_BRANDS, LINK_BRAND_KEYS } from "./linkIcons";
import { isValidIconImage } from "./dataUrlImage";

const rules = { brandKeys: LINK_BRAND_KEYS, isValidImageUrl: isValidIconImage };

describe("normalizeLinkUrl", () => {
  it("adds https to a bare address", () => {
    expect(normalizeLinkUrl("youtube.com")).toBe("https://youtube.com/");
    expect(normalizeLinkUrl("  example.org/page?q=1 ")).toBe("https://example.org/page?q=1");
    expect(normalizeLinkUrl("http://example.org")).toBe("http://example.org/");
  });

  it("rejects anything that isn't a web link", () => {
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeLinkUrl("not a link")).toBeNull();
    expect(normalizeLinkUrl("hello")).toBeNull();
  });
});

describe("brandKeyForUrl", () => {
  it("recognizes well-known sites, including subdomains and aliases", () => {
    expect(brandKeyForUrl("https://www.youtube.com/watch?v=x", LINK_BRANDS)).toBe("youtube");
    expect(brandKeyForUrl("https://youtu.be/x", LINK_BRANDS)).toBe("youtube");
    expect(brandKeyForUrl("https://twitter.com/someone", LINK_BRANDS)).toBe("x");
    expect(brandKeyForUrl("https://en.wikipedia.org/wiki/Cat", LINK_BRANDS)).toBe("wikipedia");
    expect(brandKeyForUrl("https://school.instructure.com/courses/1", LINK_BRANDS)).toBe("canvas");
  });

  it("prefers the most specific match", () => {
    expect(brandKeyForUrl("https://music.youtube.com/", LINK_BRANDS)).toBe("youtubemusic");
    expect(brandKeyForUrl("https://drive.google.com/", LINK_BRANDS)).toBe("googledrive");
    expect(brandKeyForUrl("https://www.google.com/search", LINK_BRANDS)).toBe("google");
  });

  it("doesn't match look-alike hosts or unknown sites", () => {
    expect(brandKeyForUrl("https://notyoutube.com/", LINK_BRANDS)).toBeNull();
    expect(brandKeyForUrl("https://example.org/", LINK_BRANDS)).toBeNull();
    expect(brandKeyForUrl("garbage", LINK_BRANDS)).toBeNull();
  });
});

describe("normalizeDashboardLinks", () => {
  it("keeps valid links, filling in titles and cleaning URLs", () => {
    expect(
      normalizeDashboardLinks(
        [
          { id: "a", title: " Lectures ", url: "youtube.com", icon: "brand:youtube" },
          { id: "b", title: "", url: "https://www.example.org/x", icon: "emoji:📚" },
          { id: "c", title: "Maths", url: "https://maths.example", icon: "icon:calculator" },
        ],
        rules
      )
    ).toEqual([
      { id: "a", title: "Lectures", url: "https://youtube.com/", icon: "brand:youtube" },
      { id: "b", title: "example.org", url: "https://www.example.org/x", icon: "emoji:📚" },
      { id: "c", title: "Maths", url: "https://maths.example/", icon: "icon:calculator" },
    ]);
  });

  it("drops broken entries and falls back to automatic icons", () => {
    expect(
      normalizeDashboardLinks(
        [
          { id: "a", url: "javascript:alert(1)", icon: "auto" },
          { id: "b", url: "example.org", icon: "brand:nope" },
          { id: "b", url: "example.org", icon: "auto" },
          { url: "example.org" },
          "junk",
        ],
        rules
      )
    ).toEqual([{ id: "b", title: "example.org", url: "https://example.org/", icon: "auto" }]);
    expect(normalizeDashboardLinks("nope", rules)).toBeNull();
  });

  it("parses stored JSON, empty on anything broken", () => {
    expect(parseDashboardLinks(null, rules)).toEqual([]);
    expect(parseDashboardLinks("{oops", rules)).toEqual([]);
    expect(parseDashboardLinks('[{"id":"a","url":"example.org","icon":"auto"}]', rules)).toHaveLength(1);
  });
});

describe("uploaded link icons", () => {
  const link = (id: string, icon: string) => ({ id, title: id, url: "https://example.org/", icon });

  it("accepts uploaded image URLs and rejects anything else", () => {
    const out = normalizeDashboardLinks(
      [
        { ...link("a", "image:/api/blobs/icon/abc.png") },
        { ...link("b", "image:https://x.supabase.co/storage/v1/object/public/files/icon/abc.png") },
        { ...link("c", "image:data:image/png;base64,iVBORw0KGgo=") },
        { ...link("d", "image:javascript:alert(1)") },
        { ...link("e", "image:") },
      ],
      rules
    )!;
    expect(out.map((l) => l.icon)).toEqual([
      "image:/api/blobs/icon/abc.png",
      "image:https://x.supabase.co/storage/v1/object/public/files/icon/abc.png",
      "image:data:image/png;base64,iVBORw0KGgo=",
      "auto",
      "auto",
    ]);
  });

  it("lists pictures no link uses any more, once each", () => {
    const before = [link("a", "image:/api/blobs/icon/1.png"), link("b", "image:/api/blobs/icon/2.png"), link("c", "image:/api/blobs/icon/2.png"), link("d", "auto")];
    const after = [link("a", "image:/api/blobs/icon/1.png"), link("b", "brand:youtube")];
    expect(droppedLinkIconImages(before, after)).toEqual(["/api/blobs/icon/2.png"]);
    expect(droppedLinkIconImages(after, after)).toEqual([]);
  });
});
