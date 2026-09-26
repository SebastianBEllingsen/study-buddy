import { describe, it, expect, vi, beforeEach } from "vitest";

const getAttempt = vi.fn();
const getMockExam = vi.fn();
const saveAnswers = vi.fn();
const setAttemptStatus = vi.fn();
const deleteAttempt = vi.fn();
const setAttemptPaused = vi.fn();
vi.mock("@/lib/exams/store", () => ({
  deleteAttempt: (...a: unknown[]) => deleteAttempt(...a),
  setAttemptPaused: (...a: unknown[]) => setAttemptPaused(...a),
  getAttempt: (...a: unknown[]) => getAttempt(...a),
  getMockExam: (...a: unknown[]) => getMockExam(...a),
  saveAnswers: (...a: unknown[]) => saveAnswers(...a),
  setAttemptStatus: (...a: unknown[]) => setAttemptStatus(...a),
}));
const gradeAttempt = vi.fn();
vi.mock("@/lib/exams/grade", () => ({ gradeAttempt: (...a: unknown[]) => gradeAttempt(...a) }));
const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({ getAppSettings: (...a: unknown[]) => getAppSettings(...a) }));
vi.mock("@/lib/blobStorage", () => ({
  blobKeyFromUrl: (url: string) => (url.startsWith("/api/blobs/") ? url.slice(11) : null),
}));
vi.mock("@/lib/blobStorage/local", () => ({ readLocalBlob: vi.fn() }));

const one = await import("./route");
const submit = await import("./submit/route");
const pause = await import("./pause/route");

const exam = {
  id: 3,
  tasks: [{ title: "T", prompt: "P", points: 5, concept: "C", kind: "other", rubric: [{ criterion: "c", points: 5 }], solution: "secret" }],
};
const params = Promise.resolve({ attemptId: "7" });
const answers = [{ text: "my answer", images: ["/api/blobs/answer/a.jpg"] }];

function req(method: string, body?: unknown) {
  return new Request("http://localhost/x", { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeEach(() => {
  getAttempt.mockReset().mockResolvedValue({ id: 7, mock_exam_id: 3, status: "in_progress" });
  getMockExam.mockReset().mockResolvedValue(exam);
  saveAnswers.mockReset();
  setAttemptStatus.mockReset();
  gradeAttempt.mockReset().mockResolvedValue(undefined);
  getAppSettings.mockReset().mockResolvedValue({ aiEnabled: true });
});

describe("GET/PATCH /api/mock-exam-attempts/[attemptId]", () => {
  it("hides the solution while in progress", async () => {
    const res = await one.GET(req("GET"), { params });
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("saves valid answers only while the attempt is open", async () => {
    expect((await one.PATCH(req("PATCH", { answers }), { params })).status).toBe(200);
    expect(saveAnswers).toHaveBeenCalledWith(7, answers);
    expect((await one.PATCH(req("PATCH", { answers: [] }), { params })).status).toBe(400);
    getAttempt.mockResolvedValue({ id: 7, mock_exam_id: 3, status: "graded" });
    expect((await one.PATCH(req("PATCH", { answers }), { params })).status).toBe(409);
  });
});

describe("POST /api/mock-exam-attempts/[attemptId]/submit", () => {
  it("saves the final answers, marks it grading and grades in the background", async () => {
    const res = await submit.POST(req("POST", { answers }), { params });
    expect(res.status).toBe(202);
    expect(saveAnswers).toHaveBeenCalledWith(7, answers);
    expect(setAttemptStatus).toHaveBeenCalledWith(7, "grading", { submitted: true, errorMessage: null });
    expect(gradeAttempt).toHaveBeenCalledWith(7);
  });

  it("retries a failed grading without touching the answers", async () => {
    getAttempt.mockResolvedValue({ id: 7, mock_exam_id: 3, status: "failed" });
    expect((await submit.POST(req("POST", {}), { params })).status).toBe(202);
    expect(saveAnswers).not.toHaveBeenCalled();
    expect(setAttemptStatus).toHaveBeenCalledWith(7, "grading", { submitted: false, errorMessage: null });
  });

  it("refuses a second hand-in and grading with AI off", async () => {
    getAttempt.mockResolvedValue({ id: 7, mock_exam_id: 3, status: "grading" });
    expect((await submit.POST(req("POST", {}), { params })).status).toBe(409);
    getAttempt.mockResolvedValue({ id: 7, mock_exam_id: 3, status: "in_progress" });
    getAppSettings.mockResolvedValue({ aiEnabled: false });
    expect((await submit.POST(req("POST", {}), { params })).status).toBe(400);
    expect(gradeAttempt).not.toHaveBeenCalled();
  });
});

describe("pausing and discarding", () => {
  it("pauses an open attempt and refuses a handed-in one", async () => {
    expect((await pause.POST(req("POST", { paused: true }), { params })).status).toBe(200);
    expect(setAttemptPaused).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), true);
    expect((await pause.POST(req("POST", { paused: "yes" }), { params })).status).toBe(400);
    getAttempt.mockResolvedValue({ id: 7, mock_exam_id: 3, status: "graded" });
    expect((await pause.POST(req("POST", { paused: false }), { params })).status).toBe(409);
  });

  it("discards an open attempt but never a graded one", async () => {
    expect((await one.DELETE(req("DELETE"), { params })).status).toBe(200);
    expect(deleteAttempt).toHaveBeenCalledWith(7);
    deleteAttempt.mockReset();
    getAttempt.mockResolvedValue({ id: 7, mock_exam_id: 3, status: "graded" });
    expect((await one.DELETE(req("DELETE"), { params })).status).toBe(409);
    expect(deleteAttempt).not.toHaveBeenCalled();
  });
});
