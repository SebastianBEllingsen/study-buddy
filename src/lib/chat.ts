import { generateText, resolveBackendId } from "./aiClient";
import {
  addChatMessage,
  deleteChatMessage,
  getChatConversation,
  getAppSettings,
  listDocumentsForCourse,
} from "./models";
import type { ChatAttachment, ChatMessage } from "./models";
import { buildFullCourseContextText } from "./context";
import { parseDataUrlImage, isValidChatImageAttachment } from "./dataUrlImage";
import { extensionOf } from "./documentFormats";
import { extractDocxText, extractPdfText, EmptyDocumentError, ScannedPdfError } from "./extraction";

const MAX_TOKENS = 4000;
const EFFICIENT_MAX_TOKENS = 2000;

// pdf/docx only for v1 — not txt/md — so a later "Save to course" action can
// file a chat-attached document straight through the existing course-upload
// route unchanged (documentFormats.ts's SUPPORTED_EXTENSIONS doesn't include
// txt/md).
const CHAT_DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);
// ~15MB of raw file bytes, base64-encoded (base64 runs ~4/3 the raw size) —
// the rough order of magnitude of a real lecture PDF, same class of limit as
// the course-page document upload route.
const MAX_CHAT_DOCUMENT_BASE64_LENGTH = 20_000_000;
// Roughly what chunking.ts's CHUNK_THRESHOLD_TOKENS treats as "one chunk" —
// a placeholder worth tuning against real usage, not a carefully derived
// number.
const MAX_CHAT_DOCUMENT_TEXT_LENGTH = 40_000;

const SYSTEM_PROMPT = `You are the AI assistant built into Study Buddy, a study app for courses, notes, quizzes, and flashcards. Have a natural, helpful conversation with the user — you can help with studying, explain concepts, or just chat.

You are being shown the conversation so far as a plain transcript, not a native chat API. Respond with ONLY your next message as the assistant — no "Assistant:" prefix, no restating earlier turns, no meta-commentary about the transcript format.`;

function truncateExtractedText(text: string): string {
  if (text.length <= MAX_CHAT_DOCUMENT_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_CHAT_DOCUMENT_TEXT_LENGTH)}\n...[truncated]`;
}

// Validates and extracts a message's raw (client-submitted) attachments
// into their persisted ChatAttachment shape — including running document
// bytes through the same extraction pipeline used for course-page uploads
// (extractPdfText/extractDocxText), since a chat document attachment isn't
// a `documents` table row and so never goes through that upload route.
// Anything malformed/unsupported is silently dropped rather than failing
// the whole send.
export async function validateAndExtractAttachments(raw: unknown[]): Promise<ChatAttachment[]> {
  const results: ChatAttachment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const filename = typeof a.filename === "string" ? a.filename.slice(0, 200) : "attachment";
    const mimeType = typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream";

    if (a.type === "image") {
      if (!isValidChatImageAttachment(a.dataUrl)) continue;
      results.push({ type: "image", filename, mimeType, dataUrl: a.dataUrl as string });
      continue;
    }

    if (a.type === "document") {
      if (
        typeof a.fileBase64 !== "string" ||
        a.fileBase64.length === 0 ||
        a.fileBase64.length > MAX_CHAT_DOCUMENT_BASE64_LENGTH
      ) {
        continue;
      }
      const ext = extensionOf(filename);
      if (!CHAT_DOCUMENT_EXTENSIONS.has(ext)) continue;

      const buffer = Buffer.from(a.fileBase64, "base64");
      let extractedText: string;
      try {
        const result = ext === "pdf" ? await extractPdfText(buffer) : await extractDocxText(buffer);
        extractedText = truncateExtractedText(result.text);
      } catch (err) {
        // Don't fail the whole send over an unreadable attachment — still
        // acknowledge it, with a note the model (and user, via the message
        // history) can see explaining why there's no text.
        const message =
          err instanceof ScannedPdfError || err instanceof EmptyDocumentError
            ? err.message
            : "Couldn't extract text from this file.";
        extractedText = `[Could not extract text from ${filename}: ${message}]`;
      }

      results.push({ type: "document", filename, mimeType, fileBase64: a.fileBase64, extractedText });
    }
  }

  return results;
}

function attachmentSuffix(m: ChatMessage): string {
  return (m.attachments ?? [])
    .map((a) =>
      a.type === "document"
        ? `\n[Attached document: ${a.filename}]\n${a.extractedText}`
        : `\n[Attached image: ${a.filename} — see the image provided with this request, if any]`
    )
    .join("");
}

// Every backend (API-based and CLI-based alike) already implements a plain
// system+user generateText call — rather than adding a genuine multi-turn
// messages[] path to all six of them, the whole history is folded into one
// transcript here. This is what a "send the whole history every time" chat
// API amounts to anyway, and it works identically across every backend with
// zero changes to any of them.
function buildTranscriptPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}${attachmentSuffix(m)}`)
    .join("\n\n");
}

// Persists the user's message, calls the model with the full conversation so
// far, persists the reply, and returns it. Throws whatever the active
// backend throws on failure (see describeAiError) — the caller (the
// messages API route) is responsible for translating that into a response,
// same pattern as generateForCourse.
export async function sendChatMessage(
  conversationId: number,
  content: string,
  attachments?: ChatAttachment[]
): Promise<ChatMessage> {
  const userMessage = await addChatMessage(conversationId, "user", content, attachments);

  // Everything from here on can throw (a missing conversation, the model
  // call itself) — on any of those, the user's message must not stay
  // persisted with no reply after it. The client (ChatContent.tsx) already
  // rolls back its own optimistic copy of this message on a failed send;
  // without rolling back the server's copy too, a reload would bring it
  // back, duplicated, the next time the user sent the same text.
  try {
    const detail = await getChatConversation(conversationId);
    if (!detail) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const { aiEfficiencyMode: efficient, cliTrustedModeEnabled } = await getAppSettings();

    const images = (attachments ?? [])
      .filter((a): a is Extract<ChatAttachment, { type: "image" }> => a.type === "image")
      .map((a) => parseDataUrlImage(a.dataUrl))
      .filter((img): img is { base64: string; mimeType: string } => img !== null);

    let system = SYSTEM_PROMPT;
    let documentIds: number[] | undefined;

    if (detail.conversation.courseId != null) {
      const backendId = await resolveBackendId(images.length > 0);
      const useCliWorkspace =
        (backendId === "claude_code" || backendId === "codex_cli") && cliTrustedModeEnabled;

      if (useCliWorkspace) {
        // The materializer (see aiBackends/cliWorkspace.ts) writes every
        // document's real bytes regardless of status, so passing every id
        // here (not just extracted ones) satisfies "include all documents".
        const courseDocs = await listDocumentsForCourse(detail.conversation.courseId);
        documentIds = courseDocs.map((d) => d.id);
      } else {
        const { text } = await buildFullCourseContextText(detail.conversation.courseId);
        system = `${SYSTEM_PROMPT}\n\nThe user has scoped this conversation to a course. Course material follows — use it to answer questions about the course, but you can still discuss anything else too.\n\n${text}`;
      }
    }

    const reply = await generateText({
      system,
      user: buildTranscriptPrompt(detail.messages),
      maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
      effort: efficient ? "low" : "medium",
      efficient,
      images: images.length > 0 ? images : undefined,
      workspaceScope: documentIds?.length ? { documentIds } : undefined,
    });

    return await addChatMessage(conversationId, "assistant", reply.trim());
  } catch (err) {
    await deleteChatMessage(userMessage.id).catch(() => {});
    throw err;
  }
}
