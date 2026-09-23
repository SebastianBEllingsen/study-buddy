// Where the Settings dialog was left — the open tab and how far each tab
// was scrolled — so reopening it picks up from there (see SettingsDialog).
// Kept in localStorage: a per-browser convenience, not a setting worth a
// database row, and it survives a reload.

export const SETTINGS_TABS = ["ai", "calendar", "storage", "appearance", "display"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface SettingsView {
  tab: SettingsTab;
  scroll: Partial<Record<SettingsTab, number>>;
}

export const SETTINGS_VIEW_STORAGE_KEY = "studybuddy:settings-view";

const DEFAULT_VIEW: SettingsView = { tab: "ai", scroll: {} };

export function isSettingsTab(value: unknown): value is SettingsTab {
  return (SETTINGS_TABS as readonly unknown[]).includes(value);
}

// Anything missing, malformed or from an older version falls back to the
// defaults field by field rather than failing the whole read.
export function parseSettingsView(raw: string | null): SettingsView {
  if (!raw) return DEFAULT_VIEW;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_VIEW;
  }
  if (typeof data !== "object" || data === null) return DEFAULT_VIEW;
  const { tab, scroll } = data as { tab?: unknown; scroll?: unknown };
  const view: SettingsView = { tab: isSettingsTab(tab) ? tab : DEFAULT_VIEW.tab, scroll: {} };
  if (typeof scroll === "object" && scroll !== null) {
    for (const [key, value] of Object.entries(scroll)) {
      if (isSettingsTab(key) && typeof value === "number" && Number.isFinite(value) && value > 0) {
        view.scroll[key] = Math.round(value);
      }
    }
  }
  return view;
}

export function loadSettingsView(): SettingsView {
  try {
    return parseSettingsView(localStorage.getItem(SETTINGS_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveSettingsView(view: SettingsView): void {
  try {
    localStorage.setItem(SETTINGS_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // localStorage unavailable — harmless, the dialog just opens fresh.
  }
}
