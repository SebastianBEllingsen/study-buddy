// Shared GET fetcher for every useSWR() call in the app — one place to
// decide what "not ok" means, so every hook's `error` state means the same
// thing instead of each page reimplementing its own res.ok check (or, as
// before this, several not checking at all and just assuming success).
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}
