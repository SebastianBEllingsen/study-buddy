// Shared by every route that lets a course/folder/note/the app itself carry
// a small emoji icon and/or a hex accent color (courses, folders, notes,
// app branding settings) — the same two checks were previously copy-pasted
// identically into each of those route files.

// A handful of grapheme clusters at most — plenty for an emoji, even a
// multi-codepoint one (skin tone modifiers, ZWJ sequences).
export function isValidIcon(value: unknown): value is string {
  return typeof value === "string" && value.length <= 16;
}

export function isValidColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}
