// The dashboard's Links widget: the user's own shortcuts, each with a title,
// a URL and an icon. Stored as JSON in app_settings.dashboard_links; edited
// from the dashboard's Customize dialog (components/LinksWidget.tsx).
//
// Imported by client components too, so this module must stay free of
// server-only imports: whether an uploaded icon's URL is acceptable is
// checked by a function the server passes in (isValidIconImage from
// lib/dataUrlImage.ts, which pulls in blob storage).

export interface DashboardLink {
  id: string;
  title: string;
  url: string;
  // "auto" (a known site's logo, detected from the URL, else a globe),
  // "brand:<key>" (see lib/linkIcons.ts), "icon:<key>" (GENERIC_LINK_ICONS),
  // "emoji:<emoji>" or "image:<url>" (an uploaded picture, same kinds of
  // URL a course badge image accepts).
  icon: string;
}

export const MAX_DASHBOARD_LINKS = 60;
export const MAX_LINK_TITLE = 60;

// Generic icons for links that aren't a known site — drawn by the widget
// from lucide; the keys are what gets stored.
export const GENERIC_LINK_ICONS = [
  "globe",
  "book",
  "graduation",
  "library",
  "file",
  "folder",
  "calendar",
  "mail",
  "chat",
  "video",
  "music",
  "image",
  "code",
  "calculator",
  "flask",
  "languages",
  "news",
  "briefcase",
  "cart",
  "map",
  "pen",
  "star",
  "heart",
  "link",
] as const;
export type GenericLinkIcon = (typeof GENERIC_LINK_ICONS)[number];

// What the user typed into the URL field, as a link that can be opened:
// "youtube.com" becomes "https://youtube.com". Only web links are allowed.
export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// A readable default title: the site's name from its hostname.
export function titleFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return url;
  }
}

export interface LinkIconRules {
  brandKeys: ReadonlySet<string>;
  isValidImageUrl: (url: string) => boolean;
}

function isValidIcon(icon: string, rules: LinkIconRules): boolean {
  if (icon === "auto") return true;
  if (icon.startsWith("brand:")) return rules.brandKeys.has(icon.slice(6));
  if (icon.startsWith("icon:")) return (GENERIC_LINK_ICONS as readonly string[]).includes(icon.slice(5));
  if (icon.startsWith("image:")) return icon.length > 6 && rules.isValidImageUrl(icon.slice(6));
  if (icon.startsWith("emoji:")) {
    const emoji = icon.slice(6);
    return emoji.length > 0 && [...emoji].length <= 8;
  }
  return false;
}

// Validates a stored value or an API body. Broken entries are dropped
// rather than failing the whole list; an unknown icon falls back to "auto".
export function normalizeDashboardLinks(value: unknown, rules: LinkIconRules): DashboardLink[] | null {
  if (!Array.isArray(value)) return null;
  const links: DashboardLink[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (links.length >= MAX_DASHBOARD_LINKS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, title, url, icon } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id) || typeof url !== "string") continue;
    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedUrl) continue;
    const cleanTitle = typeof title === "string" ? title.trim().slice(0, MAX_LINK_TITLE) : "";
    seen.add(id);
    links.push({
      id,
      title: cleanTitle || titleFromUrl(normalizedUrl),
      url: normalizedUrl,
      icon: typeof icon === "string" && isValidIcon(icon, rules) ? icon : "auto",
    });
  }
  return links;
}

export function parseDashboardLinks(raw: string | null | undefined, rules: LinkIconRules): DashboardLink[] {
  if (!raw) return [];
  try {
    return normalizeDashboardLinks(JSON.parse(raw), rules) ?? [];
  } catch {
    return [];
  }
}

// The uploaded picture a link's icon points at, if it is one — so the
// image's storage can be cleaned up once no link uses it any more.
export function linkIconImageUrl(icon: string): string | null {
  return icon.startsWith("image:") ? icon.slice(6) : null;
}

// Uploaded pictures `before` used that `after` no longer does.
export function droppedLinkIconImages(before: DashboardLink[], after: DashboardLink[]): string[] {
  const still = new Set(after.map((l) => linkIconImageUrl(l.icon)).filter(Boolean));
  const dropped = before.map((l) => linkIconImageUrl(l.icon)).filter((url): url is string => !!url && !still.has(url));
  return [...new Set(dropped)];
}

// The known site a URL belongs to, by hostname — the most specific match
// wins, so music.youtube.com is YouTube Music rather than YouTube.
export function brandKeyForUrl(url: string, brands: readonly { key: string; domains: readonly string[] }[]): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  let best: { key: string; length: number } | null = null;
  for (const brand of brands) {
    for (const domain of brand.domains) {
      if ((host === domain || host.endsWith(`.${domain}`)) && (!best || domain.length > best.length)) {
        best = { key: brand.key, length: domain.length };
      }
    }
  }
  return best?.key ?? null;
}
