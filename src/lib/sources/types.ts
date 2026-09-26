// How far generation trusts a source. "official": authoritative material —
// a course's own material, a textbook, official documentation. "personal": the student's own
// notes — useful, but may contain mistakes, so it only supports what the
// official material says.
export type SourceTrust = "official" | "personal";

export const SOURCE_TRUSTS: readonly SourceTrust[] = ["official", "personal"];

export function isSourceTrust(value: unknown): value is SourceTrust {
  return value === "official" || value === "personal";
}
