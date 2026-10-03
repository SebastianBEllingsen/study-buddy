import { describe, expect, it, vi, beforeEach } from "vitest";

const listMistakes = vi.fn();
const setMisconceptions = vi.fn();
const setMistakeTypes = vi.fn();
vi.mock("./mistakes", () => ({
  listMistakes: (...a: unknown[]) => listMistakes(...a),
  setMisconceptions: (...a: unknown[]) => setMisconceptions(...a),
  setMistakeTypes: (...a: unknown[]) => setMistakeTypes(...a),
}));
const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));
vi.mock("../models", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ aiEfficiencyMode: false, preferredLanguage: "de" }),
}));

const { explainMistakes, normalizeMistakeLabels, normalizeMistakeTypes, MISTAKE_BATCH_SIZE } = await import("./explainMistakes");
const { mistakeLabelSystemPrompt } = await import("../prompts/mistakes");
const { MISTAKE_TYPES, summarizeMistakeTypes, parseMistakeType } = await import("./mistakeTypes");

function mistake(id: number, misconception: string | null = null, error_type: string | null = null) {
  return { id, prompt: `Q${id}`, correct_answer: `A${id}`, given_answer: id % 2 ? `W${id}` : null, misconception, error_type };
}

beforeEach(() => {
  listMistakes.mockReset();
  setMisconceptions.mockReset();
  setMistakeTypes.mockReset();
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

describe("normalizeMistakeTypes", () => {
  it("keeps valid types for numbers in range, and leaves out anything else", () => {
    const types = normalizeMistakeTypes(
      { labels: [{ n: 1, type: "slip" }, { n: 2, type: "concept" }, { n: 3, type: "vibes" }, { n: 9, type: "recall" }, { n: 2.5, type: "method" }, { type: "slip" }] },
      3
    );
    expect([...types]).toEqual([[1, "slip"], [2, "concept"]]);
    expect(normalizeMistakeTypes({}, 2).size).toBe(0);
    expect(normalizeMistakeTypes(null, 2).size).toBe(0);
  });
});

describe("mistake types", () => {
  it("are asked for in the prompt, each with what it means", () => {
    const prompt = mistakeLabelSystemPrompt("English");
    for (const type of MISTAKE_TYPES) expect(prompt).toContain(`"${type}"`);
    expect(prompt).toContain('"type": "slip"');
  });

  it("are read strictly, and summarised most common first", () => {
    expect(parseMistakeType("slip")).toBe("slip");
    expect(parseMistakeType("Slip")).toBeNull();
    expect(parseMistakeType(3)).toBeNull();
    const summary = summarizeMistakeTypes([
      { error_type: "concept" }, { error_type: "slip" }, { error_type: "slip" }, { error_type: null }, { error_type: "nonsense" }, { error_type: "slip" },
    ]);
    expect(summary).toEqual([
      { type: "slip", count: 3, share: 0.75 },
      { type: "concept", count: 1, share: 0.25 },
    ]);
    expect(summarizeMistakeTypes([{ error_type: null }])).toEqual([]);
    // Ties keep a fixed order, so the list doesn't jump about.
    expect(summarizeMistakeTypes([{ error_type: "recall" }, { error_type: "slip" }]).map((s) => s.type)).toEqual(["slip", "recall"]);
  });
});

describe("explainMistakes", () => {
  it("labels one batch of unlabeled open mistakes in the preferred language", async () => {
    const open = [mistake(1, "already", "slip"), ...Array.from({ length: MISTAKE_BATCH_SIZE + 3 }, (_, i) => mistake(i + 2))];
    listMistakes.mockResolvedValue(open);
    generateStructured.mockResolvedValue({ labels: [{ n: 1, misconception: "Mixes up terms", type: "concept" }] });

    const result = await explainMistakes(4);

    expect(listMistakes).toHaveBeenCalledWith({ courseId: 4, status: "open" });
    const call = generateStructured.mock.calls[0][0];
    expect(call.system).toContain("German");
    expect(call.user).toContain("Question: Q2");
    expect(call.user).toContain("(couldn't recall)");
    expect(call.user).not.toContain("Q1\n");
    expect(setMisconceptions).toHaveBeenCalledWith(new Map([[2, "Mixes up terms"]]));
    // The type is saved with the note it came with.
    expect(setMistakeTypes).toHaveBeenCalledWith(new Map([[2, "concept"]]));
    expect(result).toEqual({ labeled: 1, remaining: MISTAKE_BATCH_SIZE + 2 });
  });

  it("still saves the note when the model gives no usable type", async () => {
    listMistakes.mockResolvedValue([mistake(1), mistake(2)]);
    generateStructured.mockResolvedValue({ labels: [{ n: 1, misconception: "Confuses terms", type: "nonsense" }, { n: 2, type: "slip" }] });
    const result = await explainMistakes(null);
    expect(setMisconceptions).toHaveBeenCalledWith(new Map([[1, "Confuses terms"]]));
    // Mistake 2 got a type but no note: the type is kept, and it's still waiting for its note.
    expect(setMistakeTypes).toHaveBeenCalledWith(new Map([[2, "slip"]]));
    expect(result).toEqual({ labeled: 2, remaining: 2 });
  });

  it("adds the missing type to a mistake that already has a note, and leaves the note alone", async () => {
    listMistakes.mockResolvedValue([mistake(1, "My own earlier note"), mistake(2, "Kept", "recall")]);
    generateStructured.mockResolvedValue({ labels: [{ n: 1, misconception: "A new note", type: "method" }] });
    const result = await explainMistakes(null);
    // Only the one without a type was asked about.
    expect(generateStructured.mock.calls[0][0].user).toContain("Question: Q1");
    expect(generateStructured.mock.calls[0][0].user).not.toContain("Question: Q2");
    expect(setMisconceptions).not.toHaveBeenCalled();
    expect(setMistakeTypes).toHaveBeenCalledWith(new Map([[1, "method"]]));
    expect(result).toEqual({ labeled: 1, remaining: 0 });
  });

  it("makes no AI call when everything is labeled", async () => {
    listMistakes.mockResolvedValue([mistake(1, "done", "slip")]);
    expect(await explainMistakes(null)).toEqual({ labeled: 0, remaining: 0 });
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
