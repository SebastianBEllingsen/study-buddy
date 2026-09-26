import { safeProbe } from "./urlSafety";
import { youTubePlaylistId, youTubeVideoId } from "./youtube";
import { mapWithConcurrency } from "./concurrency";
import type { LinkStatus, ResourceKind } from "./studyPlan/types";

// Checks that a study-plan resource link actually leads to learning content
// (see lib/studyPlan/). AI-suggested links are the main customer — a model
// answering from memory, or even from search, regularly produces URLs that
// 404, moved, or point at a store page instead of something readable — but
// hand-added links go through the same check.
//
// Every request goes through safeProbe (lib/urlSafety.ts), so a suggested
// URL can't be used to make this server reach a private address.

export interface LinkCheckResult {
  status: Exclude<LinkStatus, "unchecked">;
  // Short, user-facing reason — shown next to the badge.
  detail: string | null;
  // Where the link ended up after redirects — stored in place of the
  // original, which also resolves search providers' redirect links.
  finalUrl: string;
}

const USER_AGENT = "Mozilla/5.0 (compatible; StudyBuddyLinkCheck/1.0)";
const REQUEST_TIMEOUT_MS = 10_000;
const SNIPPET_BYTES = 64 * 1024;

// Store/checkout hosts — never learning content in themselves.
const STORE_HOST_PATTERNS: RegExp[] = [
  /(^|\.)amazon\.[a-z.]+$/,
  /(^|\.)amzn\.[a-z.]+$/,
  /(^|\.)ebay\.[a-z.]+$/,
  /(^|\.)abebooks\.[a-z.]+$/,
  /(^|\.)alibris\.com$/,
  /(^|\.)barnesandnoble\.com$/,
  /(^|\.)bookdepository\.com$/,
  /(^|\.)bookshop\.org$/,
  /(^|\.)thriftbooks\.com$/,
  /(^|\.)waterstones\.com$/,
  /(^|\.)walmart\.com$/,
  /(^|\.)audible\.[a-z.]+$/,
  /^books\.apple\.com$/,
];

// Checkout-ish paths on otherwise-fine hosts (publisher shops and the like).
const STORE_PATH_PATTERNS: RegExp[] = [/\/dp\//i, /\/gp\/product\//i, /\/(cart|checkout|basket)(\/|$)/i, /\/buy(\/|-|$)/i];

// Where a "book" link is presumed free to read in full. Anything else
// labeled a book still gets a chance, but only if the page doesn't look
// like a product page (see looksLikeStorePage).
const FREE_READING_HOST_PATTERNS: RegExp[] = [
  /\.edu$/,
  /\.ac\.[a-z]{2}$/,
  /\.edu\.[a-z]{2}$/,
  /\.gov$/,
  /(^|\.)openstax\.org$/,
  /(^|\.)libretexts\.org$/,
  /(^|\.)archive\.org$/,
  /(^|\.)gutenberg\.org$/,
  /(^|\.)arxiv\.org$/,
  /(^|\.)wikibooks\.org$/,
  /(^|\.)oercommons\.org$/,
  /(^|\.)oapen\.org$/,
  /(^|\.)doabooks\.org$/,
  /(^|\.)pressbooks\.[a-z]+$/,
  /(^|\.)bookdown\.org$/,
  /(^|\.)github\.io$/,
  /^github\.com$/,
  /(^|\.)gitlab\.io$/,
  /(^|\.)readthedocs\.io$/,
];

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function isFreeReadingHost(host: string): boolean {
  return FREE_READING_HOST_PATTERNS.some((re) => re.test(host));
}

// The checks that need no network: not a web link, a store, a checkout
// page. null means "fine so far — go look at it".
export function classifyResourceUrl(raw: string): LinkCheckResult | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { status: "blocked", detail: "Not a valid link", finalUrl: raw };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { status: "blocked", detail: "Not a web link", finalUrl: raw };
  }
  const host = hostOf(url);
  if (STORE_HOST_PATTERNS.some((re) => re.test(host)) || STORE_PATH_PATTERNS.some((re) => re.test(url.pathname))) {
    return { status: "blocked", detail: "Store page, not learning content", finalUrl: raw };
  }
  return null;
}

function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

const NOT_FOUND_TITLE =
  /\b(404|page not found|not found|does ?n[o']t exist|no longer (available|exists)|page (is )?unavailable|error 410)\b/i;

// A 200 that's really a "not found" page: an error title, or a deep link
// that got bounced to the site's front page.
export function isSoftNotFound(requestedUrl: string, finalUrl: string, html: string): boolean {
  const title = pageTitle(html);
  if (title && NOT_FOUND_TITLE.test(title)) return true;
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    const deepLink = requested.pathname.replace(/\/+$/, "") !== "" || requested.search !== "";
    const landedOnRoot = final.pathname.replace(/\/+$/, "") === "" && final.search === "";
    if (deepLink && landedOnRoot && hostOf(requested) === hostOf(final)) return true;
  } catch {
    // unparseable — nothing to compare
  }
  return false;
}

const STORE_PAGE_SIGNALS = /\b(add to (cart|basket|bag)|buy now|pre-?order now|in stock|out of stock)\b/i;

// For a "book" link off the free-reading list: a product page, not the
// book itself?
export function looksLikeStorePage(html: string): boolean {
  return STORE_PAGE_SIGNALS.test(html);
}

async function checkViaOEmbed(url: string, endpoint: string): Promise<LinkCheckResult> {
  const result = await safeProbe(`${endpoint}${encodeURIComponent(url)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: 16 * 1024,
  });
  if (!result.ok) return { status: "unknown", detail: "Couldn't reach the video site", finalUrl: url };
  // 401/403: the video exists but its owner disabled embedding — still watchable.
  if (result.status === 200 || result.status === 401 || result.status === 403) {
    return { status: "ok", detail: null, finalUrl: url };
  }
  if (result.status === 400 || result.status === 404) {
    return { status: "dead", detail: "Video or playlist not found", finalUrl: url };
  }
  return { status: "unknown", detail: `Video site responded ${result.status}`, finalUrl: url };
}

function isVimeo(url: string): boolean {
  try {
    return /(^|\.)vimeo\.com$/.test(hostOf(new URL(url)));
  } catch {
    return false;
  }
}

export async function verifyLink(url: string, kind: ResourceKind): Promise<LinkCheckResult> {
  const early = classifyResourceUrl(url);
  if (early) return early;

  if (youTubeVideoId(url) || youTubePlaylistId(url)) {
    return checkViaOEmbed(url, "https://www.youtube.com/oembed?format=json&url=");
  }
  if (isVimeo(url)) {
    return checkViaOEmbed(url, "https://vimeo.com/api/oembed.json?url=");
  }

  // One ranged GET rather than HEAD-then-GET: plenty of sites mishandle
  // HEAD, and the soft-404 check needs the page's <title> anyway. Servers
  // that ignore Range still get cut off at SNIPPET_BYTES.
  const result = await safeProbe(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8", Range: `bytes=0-${SNIPPET_BYTES - 1}` },
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: SNIPPET_BYTES,
  });
  if (!result.ok) {
    if (result.reason === "blocked") return { status: "blocked", detail: "Not a public address", finalUrl: url };
    if (result.reason === "unresolvable") return { status: "dead", detail: "Site not found", finalUrl: url };
    return { status: "unknown", detail: result.reason === "redirects" ? "Too many redirects" : "Site didn't respond", finalUrl: url };
  }

  const { status, finalUrl, body } = result;
  // The redirect may have landed somewhere the pre-flight checks would reject.
  const afterRedirect = finalUrl !== url ? classifyResourceUrl(finalUrl) : null;
  if (afterRedirect) return afterRedirect;

  if (status === 404 || status === 410) return { status: "dead", detail: "Page not found", finalUrl };
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    // Bot walls, rate limits, outages — the page may well be fine for a
    // person in a browser, so keep it and say we couldn't tell.
    return { status: "unknown", detail: `Site responded ${status}`, finalUrl };
  }
  if (status >= 400) return { status: "dead", detail: `Site responded ${status}`, finalUrl };

  if (isSoftNotFound(url, finalUrl, body)) return { status: "dead", detail: "Page not found", finalUrl };

  if (kind === "book" && !isFreeReadingHost(hostOf(new URL(finalUrl))) && looksLikeStorePage(body)) {
    return { status: "blocked", detail: "Book isn't free to read online", finalUrl };
  }
  return { status: "ok", detail: null, finalUrl };
}

export interface LinkToCheck {
  url: string;
  kind: ResourceKind;
}

const OVERALL_CONCURRENCY = 6;
const PER_HOST_CONCURRENCY = 2;
const DEFAULT_BUDGET_MS = 60_000;

function hostKey(url: string): string {
  try {
    return hostOf(new URL(url));
  } catch {
    return url;
  }
}

// Checks many links at once — duplicates checked once, at most
// OVERALL_CONCURRENCY in flight and PER_HOST_CONCURRENCY against any one
// site (a plan often has several links on the same site, and hammering it
// is how you get rate-limited into "unknown"). Links still waiting when
// `budgetMs` runs out come back "unknown" rather than holding the caller
// up. Results are keyed by `${kind} ${url}`; use linkCheckKey.
export async function verifyLinks(
  links: LinkToCheck[],
  options?: { budgetMs?: number; check?: typeof verifyLink }
): Promise<Map<string, LinkCheckResult>> {
  const check = options?.check ?? verifyLink;
  const deadline = Date.now() + (options?.budgetMs ?? DEFAULT_BUDGET_MS);
  const unique = [...new Map(links.map((l) => [linkCheckKey(l), l])).values()];

  const hostActive = new Map<string, number>();
  const hostWaiters = new Map<string, (() => void)[]>();
  async function acquire(host: string) {
    while ((hostActive.get(host) ?? 0) >= PER_HOST_CONCURRENCY) {
      await new Promise<void>((resolve) => hostWaiters.set(host, [...(hostWaiters.get(host) ?? []), resolve]));
    }
    hostActive.set(host, (hostActive.get(host) ?? 0) + 1);
  }
  function release(host: string) {
    hostActive.set(host, (hostActive.get(host) ?? 1) - 1);
    const [next, ...rest] = hostWaiters.get(host) ?? [];
    hostWaiters.set(host, rest);
    next?.();
  }

  const results = new Map<string, LinkCheckResult>();
  await mapWithConcurrency(unique, OVERALL_CONCURRENCY, async (link) => {
    const host = hostKey(link.url);
    await acquire(host);
    try {
      const result =
        Date.now() > deadline
          ? { status: "unknown" as const, detail: "Not checked yet", finalUrl: link.url }
          : await check(link.url, link.kind).catch(
              (): LinkCheckResult => ({ status: "unknown", detail: "Check failed", finalUrl: link.url })
            );
      results.set(linkCheckKey(link), result);
    } finally {
      release(host);
    }
  });
  return results;
}

export function linkCheckKey(link: LinkToCheck): string {
  return `${link.kind} ${link.url}`;
}
