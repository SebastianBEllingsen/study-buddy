import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("./aiClient", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));

const addChatMessage = vi.fn();
const deleteChatMessage = vi.fn();
const getChatConversation = vi.fn();
const getAppSettings = vi.fn();
vi.mock("./models", () => ({
  addChatMessage: (...args: unknown[]) => addChatMessage(...args),
  deleteChatMessage: (...args: unknown[]) => deleteChatMessage(...args),
  getChatConversation: (...args: unknown[]) => getChatConversation(...args),
  getAppSettings: (...args: unknown[]) => getAppSettings(...args),
}));

const { sendChatMessage } = await import("./chat");

beforeEach(() => {
  generateText.mockReset();
  addChatMessage.mockReset();
  deleteChatMessage.mockReset().mockResolvedValue(undefined);
  getChatConversation.mockReset();
  getAppSettings.mockReset().mockResolvedValue({ aiEfficiencyMode: false });
});

describe("sendChatMessage", () => {
  it("persists the user message, calls the model, and persists+returns the reply", async () => {
    addChatMessage
      .mockResolvedValueOnce({ id: 1, role: "user", content: "hi" })
      .mockResolvedValueOnce({ id: 2, role: "assistant", content: "hello" });
    getChatConversation.mockResolvedValue({ messages: [{ role: "user", content: "hi" }] });
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
    getChatConversation.mockResolvedValue({ messages: [{ role: "user", content: "hi" }] });
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
    getChatConversation.mockResolvedValue({ messages: [{ role: "user", content: "hi" }] });
    generateText.mockRejectedValue(new Error("rate limited"));
    deleteChatMessage.mockRejectedValue(new Error("db unavailable"));

    await expect(sendChatMessage(1, "hi")).rejects.toThrow("rate limited");
  });
});
