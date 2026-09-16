import dns from "node:dns/promises";
import net from "node:net";

// Guards server-side fetches of user-supplied URLs (calendar feed
// subscriptions — see calendarFeeds.ts) against SSRF: without this, a feed
// URL pointed at a loopback/private/link-local address (or a cloud
// metadata endpoint like 169.254.169.254) would have this server fetch it
// on every calendar load and hand parsed content back through
// /api/calendar/events. Checked both when a feed is first saved (a fast
// reject for the common case) and again immediately before every fetch (see
// calendarFeeds.ts's getParsedFeed) — a hostname that resolved to a public
// address at save time could later resolve somewhere private (DNS
// rebinding, or the operator just changing what the domain points at), and
// only a check right before the actual fetch closes that gap.
//
// Built on node:net's BlockList rather than a hand-rolled regex/bitmask
// check — an earlier version of this file did exactly that for IPv6 and
// only matched the compressed "::ffff:a.b.c.d" textual form of an
// IPv4-mapped address, missing equivalent-but-differently-written forms
// like "0:0:0:0:0:ffff:7f00:1" or "::ffff:7f00:1" (both the same address,
// 127.0.0.1, just not run through "::ffff:" + dotted-decimal). BlockList is
// a native implementation built for exactly this — it canonicalizes before
// matching, and checking an IPv4-mapped IPv6 address against a plain IPv4
// subnet (added with family "ipv4") works correctly regardless of which
// textual form the address arrives in. Verified empirically: all three
// forms above match a blocked 127.0.0.0/8 "ipv4" subnet when checked as
// family "ipv6".
const blockList = new net.BlockList();
for (const [base, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (includes cloud metadata endpoints)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
] as const) {
  blockList.addSubnet(base, bits, "ipv4");
}
for (const [base, bits] of [
  ["::1", 128], // loopback
  ["::", 128], // unspecified
  ["fe80::", 10], // link-local
  ["fc00::", 7], // unique local (fc00::/7)
  ["ff00::", 8], // multicast — the IPv4 side blocks 224.0.0.0/4 above; this is its IPv6 counterpart
  ["64:ff9b::", 96], // NAT64 well-known prefix — embeds an IPv4 address in its low 32 bits (RFC 6052),
  // so e.g. 64:ff9b::7f00:1 (127.0.0.1) would otherwise reach isBlockedIp as an
  // unrecognized-but-not-IPv4-mapped IPv6 literal and slip through
  ["2002::", 16], // 6to4 — likewise embeds an IPv4 address (in bits 16-48) that this check doesn't unpack
] as const) {
  blockList.addSubnet(base, bits, "ipv6");
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, "ipv4");
  // Checking as "ipv6" also correctly catches IPv4-mapped addresses
  // (::ffff:a.b.c.d, in any of its equivalent textual forms) against the
  // "ipv4" subnets above — BlockList unwraps them internally.
  if (family === 6) return blockList.check(ip, "ipv6");
  return true; // couldn't even parse it as an IP — refuse rather than guess
}

// True only when `url` is http(s) and every address its hostname resolves
// to is a public, non-reserved address. Rejects on any DNS failure too —
// callers should treat "can't verify it's safe" the same as "unsafe".
export async function isSafeExternalUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // URL's .hostname keeps the brackets for an IPv6 literal (e.g. "[::1]",
  // per the WHATWG URL spec) — net.isIP doesn't understand those, so
  // without stripping them a bracketed IPv6 literal would miss this fast
  // path entirely and fall through to the dns.lookup branch below, which
  // just fails to resolve it and rejects. That happens to fail closed for
  // blocked addresses, but for the wrong reason, and it wrongly rejects
  // legitimate public IPv6 literal URLs too.
  const hostname =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  // A literal IP in the URL — no DNS involved, check it directly.
  if (net.isIP(hostname)) return !isBlockedIp(hostname);

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((record) => !isBlockedIp(record.address));
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded ${maxBytes} byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  return text;
}

// A validated fetch of a user-supplied URL, safe to use for the same class
// of untrusted target isSafeExternalUrl guards (calendar feeds, and
// anywhere else the server fetches a URL a user typed in). isSafeExternalUrl
// alone isn't enough on its own: a `fetch()` with the default
// `redirect: "follow"` would validate the URL the user gave, then blindly
// follow a 30x response to wherever it points — including a loopback or
// link-local address the check above exists specifically to block. This
// re-validates every hop, refuses to follow more than MAX_REDIRECTS, and
// caps how much of the response body it will read into memory.
export async function safeFetch(
  url: string,
  init?: { timeoutMs?: number }
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeExternalUrl(currentUrl))) {
      return { ok: false, error: "URL does not resolve to a permitted address" };
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(init?.timeoutMs ?? 10_000),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Fetch failed" };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, error: `Redirect response (${res.status}) had no Location header` };
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, error: "Redirect target is not a valid URL" };
      }
      continue;
    }

    if (!res.ok) return { ok: false, error: `Responded with ${res.status}` };

    try {
      return { ok: true, text: await readCapped(res, MAX_RESPONSE_BYTES) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to read response" };
    }
  }
  return { ok: false, error: "Too many redirects" };
}
