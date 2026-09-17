import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
const resolveBackendId = vi.fn();
vi.mock("./aiClient", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  resolveBackendId: (...args: unknown[]) => resolveBackendId(...args),
}));

const addChatMessage = vi.fn();
const deleteChatMessage = vi.fn();
const getChatConversation = vi.fn();
const getAppSettings = vi.fn();
const listDocumentsForCourse = vi.fn();
vi.mock("./models", () => ({
  addChatMessage: (...args: unknown[]) => addChatMessage(...args),
  deleteChatMessage: (...args: unknown[]) => deleteChatMessage(...args),
  getChatConversation: (...args: unknown[]) => getChatConversation(...args),
  getAppSettings: (...args: unknown[]) => getAppSettings(...args),
  listDocumentsForCourse: (...args: unknown[]) => listDocumentsForCourse(...args),
}));

const buildFullCourseContextText = vi.fn();
vi.mock("./context", () => ({
  buildFullCourseContextText: (...args: unknown[]) => buildFullCourseContextText(...args),
}));

const extractPdfText = vi.fn();
const extractDocxText = vi.fn();
vi.mock("./extraction", async () => {
  const actual = await vi.importActual<typeof import("./extraction")>("./extraction");
  return {
    ...actual,
    extractPdfText: (...args: unknown[]) => extractPdfText(...args),
    extractDocxText: (...args: unknown[]) => extractDocxText(...args),
  };
});

const { sendChatMessage, validateAndExtractAttachments } = await import("./chat");

beforeEach(() => {
  generateText.mockReset();
  resolveBackendId.mockReset();
  addChatMessage.mockReset();
  deleteChatMessage.mockReset().mockResolvedValue(undefined);
  getChatConversation.mockReset();
  getAppSettings.mockReset().mockResolvedValue({ aiEfficiencyMode: false, cliTrustedModeEnabled: false });
  listDocumentsForCourse.mockReset();
  buildFullCourseContextText.mockReset();
  extractPdfText.mockReset();
  extractDocxText.mockReset();
});

describe("sendChatMessage", () => {
  it("persists the user message, calls the model, and persists+returns the reply", async () => {
    addChatMessage
      .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
      .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
    getChatConversation.mockResolvedValue({
      conversation: { courseId: null },
      messages: [{ role: "user", content: "hi" }],
    });
    generateText.mockResolvedValue("hello");

    const reply = await sendChatMessage(1, "hi");

    expect(reply).toEqual({ id: 2, role: "assistant", content: "hello" });
    expect(deleteChatMessage).not.toHaveBeenCalled();
  });

  // Regression coverage: sendChatMessage persists the user's turn before
  // calling the model. On any failure after that (conversation missing, or
  // the model call itself failing — e.g. a rate limit), the user's message
  // must not stay stranded in the conversation with no reply after it. The
  // client (ChatContent.tsx) already rolls back its own optimistic copy on
  // a failed send — without this, the server's copy would survive, and
  // reloading the conversation would bring it back duplicated the next
  // time the same text was sent.
  it("rolls back the persisted user message when the model call fails", async () => {
    addChatMessage.mockResolvedValueOnce({ id: 1, role: "user", content: "hi" });
    getChatConversation.mockResolvedValue({
      conversation: { courseId: null },
      messages: [{ role: "user", content: "hi" }],
    });
    generateText.mockRejectedValue(new Error("rate limited"));

    await expect(sendChatMessage(1, "hi")).rejects.toThrow("rate limited");
    expect(deleteChatMessage).toHaveBeenCalledWith(1);
  });

  it("rolls back the persisted user message when the conversation can't be found", async () => {
    addChatMessage.mockResolvedValueOnce({ id: 1, role: "user", content: "hi" });
    getChatConversation.mockResolvedValue(undefined);

    await expect(sendChatMessage(1, "hi")).rejects.toThrow("Conversation 1 not found");
    expect(deleteChatMessage).toHaveBeenCalledWith(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("does not let a rollback failure mask the original error", async () => {
    addChatMessage.mockResolvedValueOnce({ id: 1, role: "user", content: "hi" });
    getChatConversation.mockResolvedValue({
      conversation: { courseId: null },
      messages: [{ role: "user", content: "hi" }],
    });
    generateText.mockRejectedValue(new Error("rate limited"));
    deleteChatMessage.mockRejectedValue(new Error("db unavailable"));

    await expect(sendChatMessage(1, "hi")).rejects.toThrow("rate limited");
  });

  describe("course-scoped conversations", () => {
    it("folds course text into the system prompt when not using a trusted CLI backend", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: 7 },
        messages: [{ role: "user", content: "hi" }],
      });
      resolveBackendId.mockResolvedValue("api");
      buildFullCourseContextText.mockResolvedValue({ courseName: "Bio", text: "--- Document: x.pdf ---\nhello" });
      generateText.mockResolvedValue("hello");

      await sendChatMessage(1, "hi");

      expect(buildFullCourseContextText).toHaveBeenCalledWith(7);
      expect(listDocumentsForCourse).not.toHaveBeenCalled();
      const call = generateText.mock.calls[0][0];
      expect(call.system).toContain("--- Document: x.pdf ---");
      expect(call.workspaceScope).toBeUndefined();
    });

    it("passes every course document id as a workspaceScope when the resolved backend is a trusted CLI backend", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: 7 },
        messages: [{ role: "user", content: "hi" }],
      });
      getAppSettings.mockResolvedValue({ aiEfficiencyMode: false, cliTrustedModeEnabled: true });
      resolveBackendId.mockResolvedValue("claude_code");
      listDocumentsForCourse.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
      generateText.mockResolvedValue("hello");

      await sendChatMessage(1, "hi");

      expect(listDocumentsForCourse).toHaveBeenCalledWith(7);
      expect(buildFullCourseContextText).not.toHaveBeenCalled();
      const call = generateText.mock.calls[0][0];
      expect(call.workspaceScope).toEqual({ documentIds: [1, 2, 3] });
      expect(call.system).not.toContain("Course material follows");
    });
  });
});

describe("validateAndExtractAttachments", () => {
  const tinyPngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("keeps a valid image attachment as-is", async () => {
    const result = await validateAndExtractAttachments([
      { type: "image", filename: "photo.png", mimeType: "image/png", dataUrl: tinyPngDataUrl },
    ]);
    expect(result).toEqual([
      { type: "image", filename: "photo.png", mimeType: "image/png", dataUrl: tinyPngDataUrl },
    ]);
  });

  it("drops an image attachment with an invalid data URL", async () => {
    const result = await validateAndExtractAttachments([
      { type: "image", filename: "photo.png", mimeType: "image/png", dataUrl: "not a data url" },
    ]);
    expect(result).toEqual([]);
  });

  it("extracts text from a pdf document attachment", async () => {
    extractPdfText.mockResolvedValue({ text: "hello world", pageCount: 1, charCount: 11 });
    const result = await validateAndExtractAttachments([
      { type: "document", filename: "notes.pdf", mimeType: "application/pdf", fileBase64: "AAAA" },
    ]);
    expect(extractPdfText).toHaveBeenCalledWith(Buffer.from("AAAA", "base64"));
    expect(result).toEqual([
      {
        type: "document",
        filename: "notes.pdf",
        mimeType: "application/pdf",
        fileBase64: "AAAA",
        extractedText: "hello world",
      },
    ]);
  });

  it("drops a document with an unsupported extension", async () => {
    const result = await validateAndExtractAttachments([
      { type: "document", filename: "notes.txt", mimeType: "text/plain", fileBase64: "AAAA" },
    ]);
    expect(result).toEqual([]);
    expect(extractPdfText).not.toHaveBeenCalled();
    expect(extractDocxText).not.toHaveBeenCalled();
  });

  it("keeps the attachment with a placeholder note when extraction fails", async () => {
    extractPdfText.mockRejectedValue(new Error("This looks like a scanned or image-only PDF — OCR isn't supported yet."));
    const result = await validateAndExtractAttachments([
      { type: "document", filename: "scanned.pdf", mimeType: "application/pdf", fileBase64: "AAAA" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "document", filename: "scanned.pdf" });
    expect((result[0] as { extractedText: string }).extractedText).toContain("Could not extract text from scanned.pdf");
  });
});
