import { describe, it, expect } from "vitest";
import { parseJsonObjectBody } from "./requestBody";

function req(body: string): Request {
  return new Request("http://localhost/x", { method: "POST", body, headers: { "Content-Type": "application/json" } });
}

describe("parseJsonObjectBody", () => {
  it("returns the parsed object for a normal JSON object body", async () => {
    expect(await parseJsonObjectBody(req('{"title":"hi"}'))).toEqual({ title: "hi" });
  });

  it("returns {} for malformed JSON", async () => {
    expect(await parseJsonObjectBody(req("not json"))).toEqual({});
  });

  it("returns {} for an empty body", async () => {
    expect(await parseJsonObjectBody(req(""))).toEqual({});
  });

  // Regression coverage: `null`, a bare string, a number, and an array are
  // all valid JSON that JSON.parse succeeds on — a plain `.catch(() => ({}))`
  // around request.json() doesn't catch any of these, so a route doing a
  // bare `"x" in body` check on the result (rather than `body?.x`) would
  // throw a TypeError and 500 instead of treating it as a malformed body.
  it.each([["null", "null"], ["a bare string", '"hello"'], ["a number", "42"], ["an array", "[1,2,3]"]])(
    "returns {} for valid JSON that isn't an object (%s)",
    async (_label, json) => {
      expect(await parseJsonObjectBody(req(json))).toEqual({});
    }
  );
});
