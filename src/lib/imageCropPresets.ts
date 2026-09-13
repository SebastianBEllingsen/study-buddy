// Shared crop-target dimensions for the various "upload and position an
// image" flows (course badge/cover/backdrop, app icon, dashboard backdrop)
// — kept in one place so every full-bleed backdrop across the app (course
// page, home dashboard) crops to the exact same shape.
export const ICON_ASPECT = 1;
export const ICON_OUTPUT = 240;

export const COVER_ASPECT = 3.2;
export const COVER_OUTPUT_WIDTH = 1280;
export const COVER_OUTPUT_HEIGHT = Math.round(COVER_OUTPUT_WIDTH / COVER_ASPECT);

// The Steam-library-style full-page backdrop — wider and noticeably taller
// than the thin cover banner, since it needs to fill a whole page's
// backdrop rather than sit as a strip at the top of one.
export const BACKGROUND_ASPECT = 2.1;
export const BACKGROUND_OUTPUT_WIDTH = 1600;
export const BACKGROUND_OUTPUT_HEIGHT = Math.round(BACKGROUND_OUTPUT_WIDTH / BACKGROUND_ASPECT);
