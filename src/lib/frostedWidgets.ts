import type { HomeWidgetConfig } from "./models";

// "Frost everything" (Settings → Appearance): one switch for every widget at
// once — the dashboard's, and the Today card — while each can still be set on
// its own (Customize for the dashboard's widgets, Settings for Today).

// Whether every widget that's showing is frosted, Today included (when it's
// shown). Hidden widgets don't count: they can't be seen either way.
export function allFrosted(settings: { homeWidgets: HomeWidgetConfig[]; todayCardShown: boolean; todayCardFrosted: boolean }): boolean {
  const widgets = settings.homeWidgets.filter((w) => w.enabled);
  const todayOk = !settings.todayCardShown || settings.todayCardFrosted;
  return todayOk && widgets.every((w) => w.frosted === true) && (widgets.length > 0 || settings.todayCardShown);
}

// Every widget set the same way, hidden ones too (so they match when shown).
export function withFrosted(widgets: HomeWidgetConfig[], frosted: boolean): HomeWidgetConfig[] {
  return widgets.map((w) => {
    const copy = { ...w };
    delete copy.frosted;
    return frosted ? { ...copy, frosted: true } : copy;
  });
}
