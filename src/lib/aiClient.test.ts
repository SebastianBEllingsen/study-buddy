import { describe, it, expect, vi, beforeEach } from "vitest";

// aiClient.ts imports getAiBackend/getImageAiBackend/isAiEnabled from
// ./models, which imports ./db — whose module load connects to whatever
// backend data/storage-config.json currently points at (a real Supabase
// project in this repo). Mocked here so that never happens — same concern
// as grading.test.ts/tidyText.test.ts.
const getAiBackend = vi.fn();
const getImageAiBackend = vi.fn();
const isAiEnabled = vi.fn();
vi.mock("./models", () => ({ getAiBackend, getImageAiBackend, isAiEnabled }));

// Each backend module wraps a real SDK/subprocess/HTTP call — mocked so
// dispatch can be tested without any of that.
const anthropicApi = { generateStructured: vi.fn(), generateText: vi.fn(), describeError: vi.fn() };
const claudeCode = { generateStructured: vi.fn(), generateText: vi.fn(), describeError: vi.fn() };
const codexCli = { generateStructured: vi.fn(), generateText: vi.fn(), describeError: vi.fn() };
const openai = { generateStructured: vi.fn(), generateText: vi.fn(), describeError: vi.fn() };
const gemini = { generateStructured: vi.fn(), generateText: vi.fn(), describeError: vi.fn() };
const free = { generateStructured: vi.fn(), generateText: vi.fn(), describeError: vi.fn() };
vi.mock("./aiBackends/anthropicApi", () => anthropicApi);
vi.mock("./aiBackends/claudeCode", () => claudeCode);
vi.mock("./aiBackends/codexCli", () => codexCli);
vi.mock("./aiBackends/openai", () => openai);
vi.mock("./aiBackends/gemini", () => gemini);
vi.mock("./aiBackends/free", () => free);

const { generateStructured, generateText, describeAiError, getModelInfo, AiDisabledError } =
  await import("./aiClient");

const BACKENDS = { api: anthropicApi, claude_code: claudeCode, codex_cli: codexCli, openai, gemini, free };

beforeEach(() => {
  for (const mod of Object.values(BACKENDS)) {
    mod.generateStructured.mockReset().mockResolvedValue({ ok: true });
    mod.generateText.mockReset().mockResolvedValue("text result");
    mod.describeError.mockReset().mockReturnValue("described error");
  }
  getAiBackend.mockReset().mockResolvedValue("api");
  getImageAiBackend.mockReset().mockResolvedValue(null);
  isAiEnabled.mockReset().mockResolvedValue(true);
});

describe("generateStructured", () => {
  it("throws AiDisabledError without calling any backend when AI is disabled", async () => {
    isAiEnabled.mockResolvedValue(false);
    await expect(generateStructured({ system: "s", user: "u" })).rejects.toThrow(AiDisabledError);
    for (const mod of Object.values(BACKENDS)) {
      expect(mod.generateStructured).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["api", anthropicApi],
    ["claude_code", claudeCode],
    ["codex_cli", codexCli],
    ["openai", openai],
    ["gemini", gemini],
    ["free", free],
  ] as const)("dispatches to the %s backend when that's the configured provider", async (provider, mod) => {
    getAiBackend.mockResolvedValue(provider);
    const params = { system: "s", user: "u", maxTokens: 1234, effort: "high" as const, efficient: true };
    mod.generateStructured.mockResolvedValue({ specific: "result" });

    const result = await generateStructured(params);

    expect(mod.generateStructured).toHaveBeenCalledTimes(1);
    // The exact params object must be forwarded unchanged — a dispatch bug
    // that drops a field (e.g. maxTokens/effort) or rebuilds a new params
    // object would pass a "was it called" check but silently break
    // structured generation for every caller.
    expect(mod.generateStructured).toHaveBeenCalledWith(params);
    // And the backend's return value must actually be what this resolves
    // to, not swallowed/discarded along the way.
    expect(result).toEqual({ specific: "result" });
    for (const [otherProvider, otherMod] of Object.entries(BACKENDS)) {
      if (otherProvider !== provider) expect(otherMod.generateStructured).not.toHaveBeenCalled();
    }
  });

  it("never consults the image-backend override (that's generateText's concern)", async () => {
    getAiBackend.mockResolvedValue("api");
    await generateStructured({ system: "s", user: "u" });
    expect(getImageAiBackend).not.toHaveBeenCalled();
  });
});

describe("generateText", () => {
  it("throws AiDisabledError without calling any backend when AI is disabled", async () => {
    isAiEnabled.mockResolvedValue(false);
    await expect(generateText({ system: "s", user: "u" })).rejects.toThrow(AiDisabledError);
    for (const mod of Object.values(BACKENDS)) {
      expect(mod.generateText).not.toHaveBeenCalled();
    }
  });

  it("uses the main ai_provider when there are no images", async () => {
    getAiBackend.mockResolvedValue("openai");
    getImageAiBackend.mockResolvedValue("gemini"); // must be ignored — no images here
    const params = { system: "s", user: "u" };
    openai.generateText.mockResolvedValue("the actual text");

    const result = await generateText(params);

    expect(openai.generateText).toHaveBeenCalledTimes(1);
    expect(openai.generateText).toHaveBeenCalledWith(params);
    expect(result).toBe("the actual text");
    expect(gemini.generateText).not.toHaveBeenCalled();
  });

  it("prefers the image-backend override when images are present and an override is set", async () => {
    getAiBackend.mockResolvedValue("api");
    getImageAiBackend.mockResolvedValue("gemini");
    const params = { system: "s", user: "u", images: [{ base64: "AAAA", mimeType: "image/png" }] };
    gemini.generateText.mockResolvedValue("vision result");

    const result = await generateText(params);

    expect(gemini.generateText).toHaveBeenCalledTimes(1);
    // The images array itself — not just that *a* call happened — must
    // reach the actual backend that will send it to the model.
    expect(gemini.generateText).toHaveBeenCalledWith(params);
    expect(result).toBe("vision result");
    expect(anthropicApi.generateText).not.toHaveBeenCalled();
  });

  it("falls back to the main provider for an image call when no override is set", async () => {
    getAiBackend.mockResolvedValue("api");
    getImageAiBackend.mockResolvedValue(null);
    const params = { system: "s", user: "u", images: [{ base64: "AAAA", mimeType: "image/png" }] };
    await generateText(params);
    expect(anthropicApi.generateText).toHaveBeenCalledTimes(1);
    expect(anthropicApi.generateText).toHaveBeenCalledWith(params);
  });

  it("treats an empty images array as 'no images' for override purposes", async () => {
    getAiBackend.mockResolvedValue("api");
    getImageAiBackend.mockResolvedValue("gemini");
    await generateText({ system: "s", user: "u", images: [] });
    expect(getImageAiBackend).not.toHaveBeenCalled();
    expect(anthropicApi.generateText).toHaveBeenCalledTimes(1);
  });
});

describe("describeAiError", () => {
  it("uses the main provider's describeError when hasImages is false", async () => {
    getAiBackend.mockResolvedValue("openai");
    const err = new Error("boom");
    openai.describeError.mockReturnValue("a human-readable message");

    const result = await describeAiError(err, false);

    expect(openai.describeError).toHaveBeenCalledTimes(1);
    // The actual error object — not a stringified/rebuilt version of it —
    // must reach the backend, since some describeError implementations do
    // `instanceof` checks against specific SDK error classes.
    expect(openai.describeError).toHaveBeenCalledWith(err);
    expect(result).toBe("a human-readable message");
  });

  it("uses the image-override backend's describeError when hasImages is true and an override is set", async () => {
    getAiBackend.mockResolvedValue("api");
    getImageAiBackend.mockResolvedValue("gemini");
    const err = new Error("boom");
    await describeAiError(err, true);
    expect(gemini.describeError).toHaveBeenCalledTimes(1);
    expect(gemini.describeError).toHaveBeenCalledWith(err);
    expect(anthropicApi.describeError).not.toHaveBeenCalled();
  });

  it("defaults hasImages to false when not given", async () => {
    getAiBackend.mockResolvedValue("api");
    getImageAiBackend.mockResolvedValue("gemini");
    await describeAiError(new Error("boom"));
    expect(anthropicApi.describeError).toHaveBeenCalledTimes(1);
    expect(gemini.describeError).not.toHaveBeenCalled();
  });
});

describe("getModelInfo", () => {
  it("reports the api backend's model, honoring the efficient flag", async () => {
    getAiBackend.mockResolvedValue("api");
    expect(await getModelInfo(false)).toEqual({ provider: "api", model: "claude-sonnet-5" });
    expect(await getModelInfo(true)).toEqual({ provider: "api", model: "claude-haiku-4-5-20251001" });
  });

  it("reports the claude_code backend's model, honoring the efficient flag", async () => {
    getAiBackend.mockResolvedValue("claude_code");
    expect(await getModelInfo(false)).toEqual({ provider: "claude_code", model: "sonnet" });
    expect(await getModelInfo(true)).toEqual({ provider: "claude_code", model: "haiku" });
  });

  it("reports 'unknown' for codex_cli and free, which have no discoverable model", async () => {
    getAiBackend.mockResolvedValue("codex_cli");
    expect((await getModelInfo()).model).toBe("unknown");
    getAiBackend.mockResolvedValue("free");
    expect((await getModelInfo()).model).toBe("unknown");
  });

  it("reports the default openai/gemini model ids when no env override is set", async () => {
    delete process.env.OPENAI_MODEL;
    delete process.env.GEMINI_MODEL;
    getAiBackend.mockResolvedValue("openai");
    expect((await getModelInfo()).model).toBe("gpt-6-astra");
    getAiBackend.mockResolvedValue("gemini");
    expect((await getModelInfo()).model).toBe("gemini-3.8-flash");
  });

  it("respects an OPENAI_MODEL/GEMINI_MODEL env override", async () => {
    process.env.OPENAI_MODEL = "gpt-custom";
    getAiBackend.mockResolvedValue("openai");
    expect((await getModelInfo()).model).toBe("gpt-custom");
    delete process.env.OPENAI_MODEL;
  });
});
