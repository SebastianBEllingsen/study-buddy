import { generateText } from "./aiClient";
import { addChatMessage, getChatConversation } from "./models";
import type { ChatMessage } from "./models";

const SYSTEM_PROMPT = `You are the AI assistant built into Study Buddy, a study app for courses, notes, quizzes, and flashcards. Have a natural, helpful conversation with the user — you can help with studying, explain concepts, or just chat.

You are being shown the conversation so far as a plain transcript, not a native chat API. Respond with ONLY your next message as the assistant — no "Assistant:" prefix, no restating earlier turns, no meta-commentary about the transcript format.`;

// Every backend (API-based and CLI-based alike) already implements a plain
// system+user generateText call — rather than adding a genuine multi-turn
// messages[] path to all six of them, the whole history is folded into one
// transcript here. This is what a "send the whole history every time" chat
// API amounts to anyway, and it works identically across every backend with
// zero changes to any of them.
function buildTranscriptPrompt(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
}

// Persists the user's message, calls the model with the full conversation so
// far, persists the reply, and returns it. Throws whatever the active
// backend throws on failure (see describeAiError) — the caller (the
// messages API route) is responsible for translating that into a response,
// same pattern as generateForCourse.
export async function sendChatMessage(conversationId: number, content: string): Promise<ChatMessage> {
  await addChatMessage(conversationId, "user", content);

  const detail = await getChatConversation(conversationId);
  if (!detail) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const reply = await generateText({
    system: SYSTEM_PROMPT,
    user: buildTranscriptPrompt(detail.messages),
    maxTokens: 4000,
  });

  return addChatMessage(conversationId, "assistant", reply.trim());
}
