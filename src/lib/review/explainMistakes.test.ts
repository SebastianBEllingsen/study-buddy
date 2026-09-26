import { describe, expect, it, vi, beforeEach } from "vitest";

const listMistakes = vi.fn();
const setMisconceptions = vi.fn();
vi.mock("./mistakes", () => ({
  listMistakes: (...a: unknown[]) => listMistakes(...a),
  setMisconceptions: (...a: unknown[]) => setMisconceptions(...a),
}));
const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));
vi.mock("../models", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ aiEfficiencyMode: false, preferredLanguage: "de" }),
}));

const { explainMistakes, normalizeMistakeLabels, MISTAKE_BATCH_SIZE } = await import("./explainMistakes");

function mistake(id: number, misconception: string | null = null) {
  return { id, prompt: `Q${id}`, correct_answer: `A${id}`, given_answer: id % 2 ? `W${id}` : null, misconception };
}

beforeEach(() => {
  listMistakes.mockReset();
  setMisconceptions.mockReset();
  generateStructured.mockReset();
});

describe("normalizeMistakeLabels", () => {
  it("keeps numbered, non-empty labels within range", () => {
    const labels = normalizeMistakeLabels(
      { labels: [{ n: 1, misconception: "  Confuses  x and y " }, { n: 5, misconception: "out" }, { n: 2, misconception: 3 }] },
      2
    );
    expect([...labels]).toEqual([[1, "Confuses x and y"]]);
  });
});

describe("explainMistakes", () => {
  it("labels one batch of unlabeled open mistakes in the preferred language", async () => {
    const open = [mistake(1, "already"), ...Array.from({ length: MISTAKE_BATCH_SIZE + 3 }, (_, i) => mistake(i + 2))];
    listMistakes.mockResolvedValue(open);
    generateStructured.mockResolvedValue({ labels: [{ n: 1, misconception: "Mixes up terms" }] });

    const result = await explainMistakes(4);

    expect(listMistakes).toHaveBeenCalledWith({ courseId: 4, status: "open" });
    const call = generateStructured.mock.calls[0][0];
    expect(call.system).toContain("German");
    expect(call.user).toContain("Question: Q2");
    expect(call.user).toContain("(couldn't recall)");
    expect(call.user).not.toContain("Q1\n");
    expect(setMisconceptions).toHaveBeenCalledWith(new Map([[2, "Mixes up terms"]]));
    expect(result).toEqual({ labeled: 1, remaining: MISTAKE_BATCH_SIZE + 2 });
  });

  it("makes no AI call when everything is labeled", async () => {
    listMistakes.mockResolvedValue([mistake(1, "done")]);
    expect(await explainMistakes(null)).toEqual({ labeled: 0, remaining: 0 });
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
