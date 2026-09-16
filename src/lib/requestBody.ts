// Parses a request body as JSON and guarantees the result is always a
// plain object, never null/undefined/a primitive — every route handler in
// this app that parses a body goes on to check individual fields with
// either optional chaining (`body?.x`) or a bare `"x" in body`. The former
// is safe against any parsed value; the latter throws a TypeError for any
// non-object `in` operand (`"x" in null`, `"x" in "some string"`, `"x" in 42`
// all throw), which a request whose body is valid JSON but not an object —
// `null`, `"a string"`, `42`, `[1,2,3]` are all valid JSON — turns into an
// unhandled 500 instead of the normal `{ error }` 400 response every other
// malformed-body case gets. `.catch(() => ({}))` alone (this codebase's
// existing convention for a body that fails to parse as JSON at all) does
// NOT cover this case, since JSON.parse succeeds for all of those values.
export async function parseJsonObjectBody(request: Request): Promise<Record<string, unknown>> {
  const parsed = await request.json().catch(() => null);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
