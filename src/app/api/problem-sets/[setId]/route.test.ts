import { describe, it, expect, vi, beforeEach } from "vitest";

const actOnProblem = vi.fn();
vi.mock("@/lib/problems/service", () => ({
  ProblemSetError: class ProblemSetError extends Error {},
  actOnProblem: (...a: unknown[]) => actOnProblem(...a),
}));
vi.mock("@/lib/problems/store", () => ({ getProblemSet: vi.fn(), deleteProblemSet: vi.fn() }));
vi.mock("@/lib/aiClient", () => ({ AiDisabledError: class extends Error {}, describeAiError: vi.fn().mockResolvedValue("AI error") }));

const { POST } = await import("./route");
const params = Promise.resolve({ setId: "3" });
const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params });

const set = {
  id: 3,
  course_id: 1,
  chapter_id: null,
  kind: "coach",
  title: "Coached: X",
  practice_item_id: null,
  created_at: "",
  problems: [{ stage: "independent", concept: "C", statement: "S", steps: [{ text: "secret step", hint: "h" }], blanks: [], answer: "42" }],
  progress: [{ stepAnswers: {}, solution: null, hintsUsed: 0, revealed: [], done: false }],
};

beforeEach(() => actOnProblem.mockReset().mockResolvedValue(set));

describe("POST /api/problem-sets/[setId]", () => {
  it("runs a valid action and never sends unearned steps or answers", async () => {
    const res = await post({ action: "check", problem: 0, text: "x" });
    expect(res.status).toBe(200);
    expect(actOnProblem).toHaveBeenCalledWith(3, { action: "check", problem: 0, step: undefined, text: "x" });
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("secret step");
    expect(text).not.toContain("42");
  });

  it("rejects malformed actions without running them", async () => {
    expect((await post({ action: "check", problem: 0 })).status).toBe(400);
    expect((await post({ action: "unknown", problem: 0 })).status).toBe(400);
    expect(actOnProblem).not.toHaveBeenCalled();
  });
});
