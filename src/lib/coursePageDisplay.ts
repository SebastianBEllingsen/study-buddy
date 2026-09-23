import type { Course } from "./models";

// Settings → Appearance → Course pages: app-wide switches that hide every
// course's own backdrop/cover banner (so the app wallpaper, if on, is the
// only background inside a course) and/or its icon next to the title. The
// course keeps its images — they're just not drawn on its page.
export interface CoursePageDisplay {
  hideBackdrops: boolean;
  hideIcons: boolean;
}

// The course as its page should draw it: hidden images blanked out, so each
// header layout falls back exactly as if the course had none (no backdrop →
// the plain title header, no icon → just the name).
export function courseAsDisplayed<
  C extends Pick<Course, "page_background_image" | "cover_image" | "icon_image" | "icon">,
>(course: C, display: CoursePageDisplay): C {
  return {
    ...course,
    page_background_image: display.hideBackdrops ? null : course.page_background_image,
    cover_image: display.hideBackdrops ? null : course.cover_image,
    icon_image: display.hideIcons ? null : course.icon_image,
    icon: display.hideIcons ? null : course.icon,
  };
}
