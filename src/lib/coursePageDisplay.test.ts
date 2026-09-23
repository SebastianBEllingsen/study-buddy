import { describe, expect, it } from "vitest";
import { courseAsDisplayed } from "./coursePageDisplay";

const course = {
  id: 1,
  name: "Sample course",
  page_background_image: "/api/blobs/background/a.jpg",
  cover_image: "/api/blobs/cover/b.jpg",
  icon_image: "/api/blobs/icon/c.png",
  icon: "📘",
};

describe("courseAsDisplayed", () => {
  it("draws everything by default", () => {
    expect(courseAsDisplayed(course, { hideBackdrops: false, hideIcons: false })).toEqual(course);
  });

  it("hides the backdrop and cover banner, keeping the icon", () => {
    expect(courseAsDisplayed(course, { hideBackdrops: true, hideIcons: false })).toEqual({
      ...course,
      page_background_image: null,
      cover_image: null,
    });
  });

  it("hides the icon image and emoji, keeping the backdrop", () => {
    expect(courseAsDisplayed(course, { hideBackdrops: false, hideIcons: true })).toEqual({
      ...course,
      icon_image: null,
      icon: null,
    });
  });

  it("leaves the stored course untouched", () => {
    courseAsDisplayed(course, { hideBackdrops: true, hideIcons: true });
    expect(course.page_background_image).toBe("/api/blobs/background/a.jpg");
  });
});
