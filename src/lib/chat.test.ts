import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
const streamText = vi.fn();
const resolveBackendId = vi.fn();
vi.mock("./aiClient", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  streamText: (...args: unknown[]) => streamText(...args),
  resolveBackendId: (...args: unknown[]) => resolveBackendId(...args),
}));

const addChatMessage = vi.fn();
const deleteChatMessage = vi.fn();
const getChatConversation = vi.fn();
const getChatMessage = vi.fn();
const getAppSettings = vi.fn();
const listCourses = vi.fn();
const listDocumentsForCourse = vi.fn();
const listFoldersForCourse = vi.fn();
const updateChatMessagePendingAction = vi.fn();
const clearChatConversationTitleIfEmpty = vi.fn();
vi.mock("./models", () => ({
  clearChatConversationTitleIfEmpty: (...args: unknown[]) => clearChatConversationTitleIfEmpty(...args),
  addChatMessage: (...args: unknown[]) => addChatMessage(...args),
  deleteChatMessage: (...args: unknown[]) => deleteChatMessage(...args),
  getChatConversation: (...args: unknown[]) => getChatConversation(...args),
  getChatMessage: (...args: unknown[]) => getChatMessage(...args),
  getAppSettings: (...args: unknown[]) => getAppSettings(...args),
  listCourses: (...args: unknown[]) => listCourses(...args),
  listDocumentsForCourse: (...args: unknown[]) => listDocumentsForCourse(...args),
  listFoldersForCourse: (...args: unknown[]) => listFoldersForCourse(...args),
  updateChatMessagePendingAction: (...args: unknown[]) => updateChatMessagePendingAction(...args),
}));

const buildChatCourseContext = vi.fn();
vi.mock("./context", () => ({
  buildChatCourseContext: (...args: unknown[]) => buildChatCourseContext(...args),
}));

const buildAvailableAttachmentsList = vi.fn();
const detectChatActions = vi.fn();
const executeChatActions = vi.fn();
vi.mock("./chatActions", () => ({
  buildAvailableAttachmentsList: (...args: unknown[]) => buildAvailableAttachmentsList(...args),
  detectChatActions: (...args: unknown[]) => detectChatActions(...args),
  executeChatActions: (...args: unknown[]) => executeChatActions(...args),
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

const {
  sendChatMessage,
  validateAndExtractAttachments,
  resolvePendingAction,
  PendingActionNotFoundError,
  selectImages,
  failInterruptedActions,
} = await import("./chat");

beforeEach(() => {
  generateText.mockReset();
  streamText.mockReset();
  resolveBackendId.mockReset();
  addChatMessage.mockReset();
  deleteChatMessage.mockReset().mockResolvedValue(undefined);
  getChatConversation.mockReset();
  getChatMessage.mockReset();
  getAppSettings.mockReset().mockResolvedValue({ aiEfficiencyMode: false, cliTrustedModeEnabled: false });
  listCourses.mockReset().mockResolvedValue([]);
  listDocumentsForCourse.mockReset();
  listFoldersForCourse.mockReset().mockResolvedValue([]);
  updateChatMessagePendingAction.mockReset();
  clearChatConversationTitleIfEmpty.mockReset().mockResolvedValue(undefined);
  buildChatCourseContext.mockReset();
  extractPdfText.mockReset();
  extractDocxText.mockReset();
  buildAvailableAttachmentsList.mockReset().mockReturnValue([]);
  // Default: no action detected — every existing (non-action) test keeps
  // exercising the normal generateText path unchanged.
  detectChatActions.mockReset().mockResolvedValue({ actions: [], confirmationMessage: null });
  executeChatActions.mockReset();
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

  it("instructs the model to use LaTeX delimiters for math", async () => {
    addChatMessage
      .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
      .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
    getChatConversation.mockResolvedValue({
      conversation: { courseId: null },
      messages: [{ role: "user", content: "hi" }],
    });
    generateText.mockResolvedValue("hello");

    await sendChatMessage(1, "hi");

    expect(generateText.mock.calls[0][0].system).toContain("LaTeX");
  });

  it("strips orphaned math delimiters from the reply before persisting it", async () => {
    addChatMessage
      .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
      .mockResolvedValueOnce({ id: 2, role: "assistant", content: "answer" });
    getChatConversation.mockResolvedValue({
      conversation: { courseId: null },
      messages: [{ role: "user", content: "hi" }],
    });
    // Two orphaned "$$" endings with no real math between them — the known
    // merge artifact stripOrphanMathDelimiters guards against (see
    // mathSanitizer.test.ts for the same case against the other generation
    // paths).
    generateText.mockResolvedValue("Label one: value$$\nLabel two: value$$");

    await sendChatMessage(1, "hi");

    const [, , persistedReply] = addChatMessage.mock.calls[1];
    expect(persistedReply).not.toContain("$$");
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
    beforeEach(() => {
      listCourses.mockResolvedValue([
        { id: 7, name: "Bio" },
        { id: 8, name: "Chem" },
      ]);
    });

    it("folds course text into the system prompt when not using a trusted CLI backend", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: 7 },
        messages: [{ role: "user", content: "hi" }],
      });
      resolveBackendId.mockResolvedValue("api");
      buildChatCourseContext.mockResolvedValue({ courseName: "Bio", text: "--- Document: x.pdf ---\nhello" });
      generateText.mockResolvedValue("hello");

      await sendChatMessage(1, "hi");

      expect(buildChatCourseContext).toHaveBeenCalledWith(7, expect.any(String));
      expect(listDocumentsForCourse).not.toHaveBeenCalled();
      const call = generateText.mock.calls[0][0];
      expect(call.system).toContain("--- Document: x.pdf ---");
      expect(call.workspaceScope).toBeUndefined();
    });

    it("passes every course document id as a workspaceScope, and still includes the extracted text, when the resolved backend is a trusted CLI backend", async () => {
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
      buildChatCourseContext.mockResolvedValue({ courseName: "Bio", text: "--- Document: slides.pptx ---\nrule 1" });
      generateText.mockResolvedValue("hello");

      await sendChatMessage(1, "hi");

      expect(listDocumentsForCourse).toHaveBeenCalledWith(7);
      const call = generateText.mock.calls[0][0];
      expect(call.workspaceScope).toEqual({ documentIds: [1, 2, 3] });
      expect(call.system).toContain("--- Document: slides.pptx ---");
      expect(call.system).toContain("Never run shell commands to convert files");
    });

    it("lists courses the conversation can't see by name only, and never loads their content", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: 7 },
        messages: [{ role: "user", content: "hi" }],
      });
      resolveBackendId.mockResolvedValue("api");
      buildChatCourseContext.mockResolvedValue({ courseName: "Bio", text: "bio text" });
      generateText.mockResolvedValue("hello");

      await sendChatMessage(1, "hi");

      expect(buildChatCourseContext).toHaveBeenCalledTimes(1);
      expect(buildChatCourseContext).not.toHaveBeenCalledWith(8);
      const system: string = generateText.mock.calls[0][0].system;
      expect(system).toContain("- Chem");
      expect(system).not.toContain("- Bio");
    });

    it("includes a course's content once the user confirmed reading it", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 3, role: "user", content: "what's in chem?" })
        .mockResolvedValueOnce({ id: 4, role: "assistant", content: "ok" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: null },
        messages: [
          {
            id: 2,
            role: "assistant",
            content: "May I read Chem?",
            pendingAction: {
              id: "a",
              actions: [{ action: "readCourse", courseId: 8 }],
              status: "executed",
              resultSummary: "Allowed",
            },
          },
          { id: 3, role: "user", content: "what's in chem?" },
        ],
      });
      resolveBackendId.mockResolvedValue("api");
      buildChatCourseContext.mockResolvedValue({ courseName: "Chem", text: "--- Note: Atoms ---\nbody" });
      generateText.mockResolvedValue("ok");

      await sendChatMessage(1, "what's in chem?");

      expect(buildChatCourseContext).toHaveBeenCalledWith(8, expect.any(String));
      expect(generateText.mock.calls[0][0].system).toContain("--- Note: Atoms ---");
      // The detector sees the granted course as accessible (and its folders).
      expect(detectChatActions.mock.calls[0][0]).toMatchObject({ accessibleCourseIds: [8], scopedCourseId: null });
      expect(listFoldersForCourse).toHaveBeenCalledWith(8);
    });

    it("does not treat a pending or cancelled readCourse as a grant", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 3, role: "user", content: "hi" })
        .mockResolvedValueOnce({ id: 4, role: "assistant", content: "ok" });
      const readCourse = [{ action: "readCourse", courseId: 8 }];
      getChatConversation.mockResolvedValue({
        conversation: { courseId: null },
        messages: [
          { id: 1, role: "assistant", content: "?", pendingAction: { id: "a", actions: readCourse, status: "pending", resultSummary: null } },
          { id: 2, role: "assistant", content: "?", pendingAction: { id: "b", actions: readCourse, status: "cancelled", resultSummary: null } },
          { id: 3, role: "user", content: "hi" },
        ],
      });
      generateText.mockResolvedValue("ok");

      await sendChatMessage(1, "hi");

      expect(buildChatCourseContext).not.toHaveBeenCalled();
      expect(detectChatActions.mock.calls[0][0].accessibleCourseIds).toEqual([]);
    });

    it("streams the reply, holding text back until action detection has finished", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello there" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: null },
        messages: [{ id: 1, role: "user", content: "hi" }],
      });
      let finishDetection!: () => void;
      detectChatActions.mockReturnValue(
        new Promise((resolve) => {
          finishDetection = () => resolve({ actions: [], confirmationMessage: null });
        })
      );
      streamText.mockImplementation(async (_params: unknown, onDelta: (t: string) => void) => {
        onDelta("hello ");
        onDelta("there");
        return "hello there";
      });
      const deltas: string[] = [];

      const sent = sendChatMessage(1, "hi", undefined, (t) => deltas.push(t));
      await new Promise((r) => setTimeout(r, 0));
      expect(deltas).toEqual([]);

      finishDetection();
      await sent;
      expect(deltas.join("")).toBe("hello there");
      expect(generateText).not.toHaveBeenCalled();
    });

    it("never shows streamed text when an action is proposed instead", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "make a course" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "Create it?" });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: null },
        messages: [{ id: 1, role: "user", content: "make a course" }],
      });
      detectChatActions.mockResolvedValue({
        actions: [{ action: "createCourse", courseName: "Sample" }],
        confirmationMessage: "Create it?",
      });
      streamText.mockImplementation(async (_params: unknown, onDelta: (t: string) => void) => {
        onDelta("ignored reply");
        return "ignored reply";
      });
      const deltas: string[] = [];

      await sendChatMessage(1, "make a course", undefined, (t) => deltas.push(t));

      expect(deltas).toEqual([]);
    });

    it("runs action detection for an unscoped conversation too", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "make me a course" })
        .mockResolvedValueOnce({ id: 2, role: "assistant", content: "Create it?", pendingAction: {} });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: null },
        messages: [{ id: 1, role: "user", content: "make me a course" }],
      });
      detectChatActions.mockResolvedValue({
        actions: [{ action: "createCourse", courseName: "Sample" }],
        confirmationMessage: "Create it?",
      });

      await sendChatMessage(1, "make me a course");

      // The reply call runs in parallel with detection, but its text is discarded.
      expect(addChatMessage.mock.calls[1][2]).toBe("Create it?");
      expect(addChatMessage.mock.calls[1][4]).toMatchObject({
        status: "pending",
        actions: [{ action: "createCourse", courseName: "Sample" }],
      });
    });

    it("proposes a pending action instead of replying normally, when one is detected", async () => {
      addChatMessage
        .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
        .mockResolvedValueOnce({
          id: 2,
          role: "assistant",
          content: 'I\'ll create a folder called "Diagrams" and save photo.png there — go ahead?',
          pendingAction: { id: "abc", actions: [{ action: "createFolder", folderName: "Diagrams" }], status: "pending", resultSummary: null },
        });
      getChatConversation.mockResolvedValue({
        conversation: { courseId: 7 },
        messages: [{ id: 1, role: "user", content: "make a folder called Diagrams" }],
      });
      detectChatActions.mockResolvedValue({
        actions: [{ action: "createFolder", folderName: "Diagrams" }],
        confirmationMessage: 'I\'ll create a folder called "Diagrams" and save photo.png there — go ahead?',
      });

      const reply = await sendChatMessage(1, "make a folder called Diagrams");

      expect(reply.pendingAction?.status).toBe("pending");
      expect(generateText).not.toHaveBeenCalled();
      // Second addChatMessage call persists the assistant's proposal with
      // the detected actions attached.
      const [, role, content, attachments, pendingAction] = addChatMessage.mock.calls[1];
      expect(role).toBe("assistant");
      expect(content).toContain("Diagrams");
      expect(attachments).toBeUndefined();
      expect(pendingAction).toMatchObject({
        status: "pending",
        actions: [{ action: "createFolder", folderName: "Diagrams" }],
      });
    });
  });
});

describe("resolvePendingAction", () => {
  it("cancels a pending action without executing anything", async () => {
    getChatMessage.mockResolvedValue({
      id: 5,
      conversationId: 1,
      pendingAction: { id: "abc", actions: [{ action: "createFolder", folderName: "X" }], status: "pending", resultSummary: null },
    });

    const result = await resolvePendingAction(1, 5, false);

    expect(result.pendingAction?.status).toBe("cancelled");
    expect(executeChatActions).not.toHaveBeenCalled();
    expect(updateChatMessagePendingAction).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("executes actions on confirm and records the result summary", async () => {
    const pendingAction = {
      id: "abc",
      actions: [{ action: "createFolder", folderName: "X" }],
      status: "pending" as const,
      resultSummary: null,
    };
    getChatMessage.mockResolvedValue({ id: 5, conversationId: 1, pendingAction });
    getChatConversation.mockResolvedValue({
      conversation: { courseId: 7 },
      messages: [],
    });
    executeChatActions.mockResolvedValue('Created folder "X".');

    const result = await resolvePendingAction(1, 5, true);

    expect(executeChatActions).toHaveBeenCalledWith(7, pendingAction.actions, []);
    expect(result.pendingAction).toMatchObject({ status: "executed", resultSummary: 'Created folder "X".' });
  });

  it("runs a confirmed action in a conversation with no course, and makes no follow-up for a non-read action", async () => {
    const pendingAction = {
      id: "abc",
      actions: [{ action: "createCourse", courseName: "Sample" }],
      status: "pending" as const,
      resultSummary: null,
    };
    getChatMessage.mockResolvedValue({ id: 5, conversationId: 1, pendingAction });
    getChatConversation.mockResolvedValue({ conversation: { courseId: null }, messages: [] });
    executeChatActions.mockResolvedValue('Created course "Sample".');

    const result = await resolvePendingAction(1, 5, true);

    expect(executeChatActions).toHaveBeenCalledWith(null, pendingAction.actions, []);
    expect(result.followUp).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("answers the original request with the course visible after a confirmed readCourse", async () => {
    const pendingAction = {
      id: "abc",
      actions: [{ action: "readCourse", courseId: 8 }],
      status: "pending" as const,
      resultSummary: null,
    };
    const proposal = { id: 5, conversationId: 1, role: "assistant", content: "May I read Chem?", pendingAction };
    getChatMessage.mockResolvedValue(proposal);
    // The DB copy still shows the proposal pending; the follow-up must use
    // the resolved one or the course would not count as granted.
    getChatConversation.mockResolvedValue({
      conversation: { courseId: null },
      messages: [{ id: 4, role: "user", content: "summarise chem" }, proposal],
    });
    listCourses.mockResolvedValue([{ id: 8, name: "Chem" }]);
    executeChatActions.mockResolvedValue('Allowed to read "Chem" in this conversation.');
    resolveBackendId.mockResolvedValue("api");
    buildChatCourseContext.mockResolvedValue({ courseName: "Chem", text: "chem text" });
    generateText.mockResolvedValue("Here is a summary");
    addChatMessage.mockResolvedValue({ id: 6, role: "assistant", content: "Here is a summary" });

    const result = await resolvePendingAction(1, 5, true);

    expect(buildChatCourseContext).toHaveBeenCalledWith(8, expect.any(String));
    expect(generateText.mock.calls[0][0].system).toContain("chem text");
    expect(result.followUp).toEqual({ id: 6, role: "assistant", content: "Here is a summary" });
  });

  it("still resolves the action if the follow-up reply fails", async () => {
    const pendingAction = {
      id: "abc",
      actions: [{ action: "readCourse", courseId: 8 }],
      status: "pending" as const,
      resultSummary: null,
    };
    getChatMessage.mockResolvedValue({ id: 5, conversationId: 1, pendingAction });
    getChatConversation.mockResolvedValue({ conversation: { courseId: null }, messages: [] });
    listCourses.mockResolvedValue([{ id: 8, name: "Chem" }]);
    executeChatActions.mockResolvedValue("ok");
    resolveBackendId.mockResolvedValue("api");
    buildChatCourseContext.mockResolvedValue({ courseName: "Chem", text: "t" });
    generateText.mockRejectedValue(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await resolvePendingAction(1, 5, true);

    expect(result.pendingAction?.status).toBe("executed");
    expect(result.followUp).toBeNull();
  });

  it("throws when the message has no pending action", async () => {
    getChatMessage.mockResolvedValue({ id: 5, conversationId: 1, pendingAction: null });

    await expect(resolvePendingAction(1, 5, true)).rejects.toThrow(PendingActionNotFoundError);
  });

  it("is a no-op (doesn't re-execute) when the action was already resolved", async () => {
    const resolved = {
      id: "abc",
      actions: [{ action: "createFolder", folderName: "X" }],
      status: "executed" as const,
      resultSummary: 'Created folder "X".',
    };
    getChatMessage.mockResolvedValue({ id: 5, conversationId: 1, pendingAction: resolved });

    const result = await resolvePendingAction(1, 5, true);

    expect(executeChatActions).not.toHaveBeenCalled();
    expect(updateChatMessagePendingAction).not.toHaveBeenCalled();
    expect(result.pendingAction).toEqual(resolved);
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

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const image = (filename: string) => ({ type: "image" as const, filename, mimeType: "image/png", dataUrl: png });

describe("selectImages", () => {
  const messages = [
    { id: 1, role: "user", content: "a", attachments: [image("one.png")] },
    { id: 2, role: "assistant", content: "b", attachments: null },
    { id: 3, role: "user", content: "c", attachments: null },
  ] as never[];

  it("keeps pictures from earlier turns so follow-ups can still see them", () => {
    expect(selectImages(messages, true).map((a) => a.filename)).toEqual(["one.png"]);
  });

  it("keeps only the latest message's own pictures when history is excluded", () => {
    expect(selectImages(messages, false)).toEqual([]);
  });

  it("caps how many go out, newest first, returned oldest first", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      role: "user",
      content: "",
      attachments: [image(`p${i}.png`)],
    })) as never[];
    expect(selectImages(many, true).map((a) => a.filename)).toEqual(["p2.png", "p3.png", "p4.png", "p5.png"]);
  });
});

describe("chat reply context", () => {
  function setup(messages: unknown[], backend = "api", trusted = false) {
    addChatMessage
      .mockResolvedValueOnce({ id: 99, role: "user", content: "x" })
      .mockResolvedValueOnce({ id: 100, role: "assistant", content: "ok" });
    getChatConversation.mockResolvedValue({ conversation: { courseId: null }, messages });
    getAppSettings.mockResolvedValue({ aiEfficiencyMode: false, cliTrustedModeEnabled: trusted });
    resolveBackendId.mockResolvedValue(backend);
  }

  it("sends pictures from earlier turns and numbers them in the transcript", async () => {
    setup([
      { id: 1, role: "user", content: "what is this?", attachments: [image("quiz.png")] },
      { id: 2, role: "assistant", content: "A quiz." },
      { id: 3, role: "user", content: "and the second part?" },
    ]);
    generateText.mockResolvedValue("ok");

    await sendChatMessage(1, "and the second part?");

    const call = generateText.mock.calls[0][0];
    expect(call.images).toHaveLength(1);
    expect(call.user).toContain("[Attached image 1: quiz.png");
  });

  it("leaves earlier pictures out for a CLI backend that can't take images", async () => {
    setup(
      [
        { id: 1, role: "user", content: "what is this?", attachments: [image("quiz.png")] },
        { id: 2, role: "assistant", content: "A quiz." },
        { id: 3, role: "user", content: "and the second part?" },
      ],
      "claude_code"
    );
    generateText.mockResolvedValue("ok");

    await sendChatMessage(1, "and the second part?");

    const call = generateText.mock.calls[0][0];
    expect(call.images).toBeUndefined();
    expect(call.user).toContain("not shown with this request");
  });

  it("repeats document text only for the two most recent attachments", async () => {
    const doc = (name: string) => ({
      type: "document" as const,
      filename: name,
      mimeType: "application/pdf",
      fileBase64: "x",
      extractedText: `TEXT-OF-${name}`,
    });
    setup([
      { id: 1, role: "user", content: "a", attachments: [doc("one.pdf")] },
      { id: 2, role: "user", content: "b", attachments: [doc("two.pdf")] },
      { id: 3, role: "user", content: "c", attachments: [doc("three.pdf")] },
    ]);
    generateText.mockResolvedValue("ok");

    await sendChatMessage(1, "c");

    const { user } = generateText.mock.calls[0][0];
    expect(user).not.toContain("TEXT-OF-one.pdf");
    expect(user).toContain("TEXT-OF-two.pdf");
    expect(user).toContain("TEXT-OF-three.pdf");
  });

  it("drops the oldest messages once the transcript is too long, keeping the latest", async () => {
    const big = "word ".repeat(15_000);
    setup([
      { id: 1, role: "user", content: `OLDEST ${big}` },
      { id: 2, role: "assistant", content: `MIDDLE ${big}` },
      { id: 3, role: "user", content: `NEWEST ${big}` },
    ]);
    generateText.mockResolvedValue("ok");

    await sendChatMessage(1, "x");

    const { user } = generateText.mock.calls[0][0];
    expect(user).toContain("left out for length");
    expect(user).toContain("NEWEST");
    expect(user).not.toContain("OLDEST");
  });

  it("tells the user when the reply was cut off by the length limit", async () => {
    setup([{ id: 1, role: "user", content: "hi" }]);
    generateText.mockImplementation(async (params: { onTruncated?: () => void }) => {
      params.onTruncated?.();
      return "A long answer that stops mid-";
    });

    await sendChatMessage(1, "hi");

    expect(addChatMessage.mock.calls[1][2]).toContain("cut off by the length limit");
  });

  it("clears the conversation title when a failed first message is rolled back", async () => {
    addChatMessage.mockResolvedValueOnce({ id: 99, role: "user", content: "x" });
    getChatConversation.mockResolvedValue(undefined);

    await expect(sendChatMessage(1, "x")).rejects.toThrow();

    expect(clearChatConversationTitleIfEmpty).toHaveBeenCalledWith(1);
  });
});

describe("pending action safety", () => {
  const pendingAction = { id: "a", actions: [{ action: "createFolder", folderName: "X" }], status: "pending" as const, resultSummary: null };

  it("runs a proposal once when it is confirmed twice at the same time", async () => {
    getChatMessage.mockResolvedValue({ id: 5, conversationId: 1, pendingAction });
    getChatConversation.mockResolvedValue({ conversation: { courseId: 7 }, messages: [] });
    executeChatActions.mockResolvedValue("Created.");

    await Promise.all([resolvePendingAction(1, 5, true), resolvePendingAction(1, 5, true)]);

    expect(executeChatActions).toHaveBeenCalledTimes(1);
  });

  it("marks a proposal left running by an interrupted process as failed", async () => {
    const stuck = { id: 7, pendingAction: { ...pendingAction, status: "confirmed_executing" as const } };

    const [fixed] = await failInterruptedActions([stuck as never]);

    expect(fixed.pendingAction?.status).toBe("failed");
    expect(updateChatMessagePendingAction).toHaveBeenCalledWith(7, expect.objectContaining({ status: "failed" }));
  });
});
