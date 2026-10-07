import { describe, expect, it } from "vitest";
import { cppToolchainAvailable } from "@/lib/code/cppRunner";
import { POST } from "./route";

const body = { language: "cpp", code: "int one() { return 1; }", tests: [{ name: "one", code: "CHECK_EQ(one(), 1);" }] };
const post = (headers: Record<string, string>, payload: unknown = body) =>
  POST(new Request("http://127.0.0.1:3000/api/code/run", { method: "POST", headers, body: JSON.stringify(payload) }));
const local = { host: "127.0.0.1:3000", "content-type": "application/json" };

describe("POST /api/code/run", () => {
  it("refuses a request that isn't from the app's own page on localhost", async () => {
    expect((await post({ ...local, origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ ...local, host: "evil.example" })).status).toBe(403);
    expect((await post({ ...local, "content-type": "text/plain" })).status).toBe(403);
  });

  it("rejects a malformed request", async () => {
    expect((await post(local, { ...body, language: "python" })).status).toBe(400);
    expect((await post(local, { ...body, tests: "nope" })).status).toBe(400);
  });

  it.skipIf(!cppToolchainAvailable())("compiles and runs C++, returning the runner's result", async () => {
    const response = await post({ ...local, origin: "http://127.0.0.1:3000" });
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.error).toBeNull();
    expect(result.tests).toEqual([{ name: "one", passed: true, message: null }]);
  }, 60_000);
});
