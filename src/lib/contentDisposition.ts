// A Content-Disposition header value for a file named by a user. Header
// values must be Latin-1 (a Response throws on anything wider, so a name with
// a CJK character, an en dash or a macOS screenshot's narrow no-break space
// would fail the whole request), so the plain `filename` is an ASCII
// fallback and `filename*` carries the real name (RFC 6266 / 8187).
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const name = filename.replace(/[\r\n]+/g, " ").trim() || "file";
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
