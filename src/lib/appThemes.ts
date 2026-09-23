// Every appearance theme (Settings → Appearance), in menu order. A plain
// module rather than part of AppThemeProvider.tsx so the server-rendered
// layout can read the real array for its before-first-paint script — a
// "use client" module's exports are only references on the server.
export const APP_THEMES = [
  "calm",
  "gamified",
  "mono",
  "sepia",
  "blueprint",
  "canvas",
  "solarized",
  "nord",
  "terminal",
  "sakura",
  "chalkboard",
  "highlighter",
  "index-card",
  "brutal",
  "win98",
  "synthwave",
  "illuminated",
  "holo",
  "comic",
] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export const APP_THEME_STORAGE_KEY = "studybuddy-app-theme";

export function isAppTheme(value: unknown): value is AppTheme {
  return (APP_THEMES as readonly unknown[]).includes(value);
}

// Sets data-app-theme before first paint so a viewer who picked a
// non-default theme doesn't see a flash of "calm" on load — the same
// reasoning as next-themes' own blocking script for the "dark" class.
export function appThemeBootScript(): string {
  return `try{var t=localStorage.getItem(${JSON.stringify(APP_THEME_STORAGE_KEY)});if(${JSON.stringify(APP_THEMES)}.indexOf(t)>0)document.documentElement.setAttribute('data-app-theme',t)}catch(e){}`;
}
