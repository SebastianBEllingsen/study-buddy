import crypto from "node:crypto";
import { generateText, resolveBackendId, streamText } from "./aiClient";
import {
  addChatMessage,
  deleteChatMessage,
  getChatConversation,
  getChatMessage,
  getAppSettings,
  listCourses,
  listDocumentsForCourse,
  listFoldersForCourse,
  updateChatMessagePendingAction,
} from "./models";
import type { ChatAttachment, ChatConversation, ChatMessage, Course, PendingChatAction } from "./models";
import { buildChatCourseContext } from "./context";
import { tokenize } from "./courseRetrieval";
import { parseDataUrlImage, isValidChatImageAttachment } from "./dataUrlImage";
import { extensionOf } from "./documentFormats";
import { extractDocxText, extractPdfText, EmptyDocumentError, ScannedPdfError } from "./extraction";
import { stripOrphanMathDelimiters } from "./mathSanitizer";
import { buildAvailableAttachmentsList, detectChatActions, executeChatActions } from "./chatActions";

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

You are being shown the conversation so far as a plain transcript, not a native chat API. Respond with ONLY your next message as the assistant — no "Assistant:" prefix, no restating earlier turns, no meta-commentary about the transcript format.

You can't create or read anything in the user's courses on your own: creating a course, folder or note, or looking inside a course, only happens after the user confirms a proposal. Never claim you have created or read something unless it's shown to you below.

Use inline LaTeX ($...$ or $$...$$) for any math, it renders.`;

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

// The message's own `content` already carries the human-readable proposal
// text (the model's confirmationMessage, see sendChatMessage) — this only
// adds what happened SINCE it was proposed, for multi-turn continuity (so a
// later turn knows whether that proposal is still open, was declined, or
// already went through).
function pendingActionSuffix(m: ChatMessage): string {
  const p = m.pendingAction;
  if (!p) return "";
  if (p.status === "pending" || p.status === "confirmed_executing") {
    return "\n[Awaiting the user's confirmation to proceed — nothing has happened yet]";
  }
  if (p.status === "cancelled") {
    return "\n[The user declined — nothing was created or saved]";
  }
  return `\n[Result: ${p.resultSummary}]`;
}

// Every backend (API-based and CLI-based alike) already implements a plain
// system+user generateText call — rather than adding a genuine multi-turn
// messages[] path to all six of them, the whole history is folded into one
// transcript here. This is what a "send the whole history every time" chat
// API amounts to anyway, and it works identically across every backend with
// zero changes to any of them.
function buildTranscriptPrompt(messages: ChatMessage[]): string {
  return messages
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Assistant"}: ${m.content}${attachmentSuffix(m)}${pendingActionSuffix(m)}`
    )
    .join("\n\n");
}

// Persists the user's message, calls the model with the full conversation so
// far, persists the reply, and returns it. Throws whatever the active
// backend throws on failure (see describeAiError) — the caller (the
// messages API route) is responsible for translating that into a response,
// same pattern as generateForCourse.
//
// With onDelta, the reply's text is passed to it as the model writes it. The
// action check above runs in parallel, so deltas are held back until it has
// ruled out a proposal — a proposal replaces the reply, and half-shown text
// would have to be taken back. The returned message is always the final,
// sanitized one; callers should swap it in for whatever was streamed.
export async function sendChatMessage(
  conversationId: number,
  content: string,
  attachments?: ChatAttachment[],
  onDelta?: (text: string) => void
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

    const transcript = buildTranscriptPrompt(detail.messages);

    // Proposed against every course, but only ever executed after the user
    // confirms — see chatActions.ts for how everything here gets
    // re-validated before anything is actually created/saved/read. This is
    // a separate, cheap detection call; when it finds something to propose,
    // its confirmationMessage stands in as this turn's whole reply (nothing
    // executes until the user confirms — see resolvePendingAction).
    const scopedCourseId = detail.conversation.courseId;
    const courses = await listCourses();
    const accessibleCourseIds = accessibleCourseIdsFor(detail.conversation, detail.messages, courses);
    const folders = (await Promise.all(accessibleCourseIds.map((id) => listFoldersForCourse(id)))).flat();
    // Run alongside the reply call below instead of before it, so a normal
    // message costs one model round-trip of latency, not two. When an action
    // is proposed the reply is simply discarded.
    const detectedPromise = detectChatActions({
      transcript,
      availableAttachments: buildAvailableAttachmentsList(detail.messages),
      courses,
      scopedCourseId,
      accessibleCourseIds,
      folders,
    });

    const images = (attachments ?? [])
      .filter((a): a is Extract<ChatAttachment, { type: "image" }> => a.type === "image")
      .map((a) => parseDataUrlImage(a.dataUrl))
      .filter((img): img is { base64: string; mimeType: string } => img !== null);

    let released = false;
    let held = "";
    const releasingOnDelta = onDelta
      ? (text: string) => {
          if (released) onDelta(text);
          else held += text;
        }
      : undefined;
    const replyPromise = generateConversationReply(detail.conversation, detail.messages, courses, {
      images,
      onDelta: releasingOnDelta,
    });
    // If detection wins, nobody awaits this — don't let its failure go unhandled.
    replyPromise.catch(() => {});

    const detected = await detectedPromise;

    if (detected.actions.length > 0 && detected.confirmationMessage) {
      const pendingAction: PendingChatAction = {
        id: crypto.randomUUID(),
        actions: detected.actions,
        status: "pending",
        resultSummary: null,
      };
      return await addChatMessage(
        conversationId,
        "assistant",
        stripOrphanMathDelimiters(detected.confirmationMessage),
        undefined,
        pendingAction
      );
    }

    released = true;
    if (held && onDelta) onDelta(held);
    const reply = await replyPromise;
    return await addChatMessage(conversationId, "assistant", reply);
  } catch (err) {
    await deleteChatMessage(userMessage.id).catch(() => {});
    throw err;
  }
}

// Courses the user has allowed the assistant to read in this conversation:
// every readCourse action on a message whose confirmation went through.
// Derived from the message history rather than stored separately, so
// granting needs no schema change and a cancelled/failed proposal grants
// nothing.
export function grantedCourseIds(messages: ChatMessage[]): number[] {
  const ids = new Set<number>();
  for (const m of messages) {
    if (m.pendingAction?.status !== "executed") continue;
    for (const action of m.pendingAction.actions) {
      if (action.action === "readCourse") ids.add(action.courseId);
    }
  }
  return [...ids];
}

// The course this conversation is scoped to plus every granted one — the
// only courses whose content (and folders) the assistant ever sees. Ids of
// courses that no longer exist are dropped.
function accessibleCourseIdsFor(
  conversation: ChatConversation,
  messages: ChatMessage[],
  courses: Pick<Course, "id">[]
): number[] {
  const existing = new Set(courses.map((c) => c.id));
  const ids = new Set<number>();
  if (conversation.courseId != null) ids.add(conversation.courseId);
  for (const id of grantedCourseIds(messages)) ids.add(id);
  return [...ids].filter((id) => existing.has(id));
}

// What to look up in the course for this turn: the user's latest message, plus
// the exchange before it when the message is too short to search on by itself
// ("explain that more", "and the second one?").
export function retrievalQuery(messages: ChatMessage[]): string {
  const users = messages.filter((m) => m.role === "user");
  const latest = users[users.length - 1]?.content ?? "";
  if (tokenize(latest).length >= 4) return latest;
  const previousUser = users[users.length - 2]?.content ?? "";
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  return [latest, previousUser, lastAssistant.slice(0, 600)].join("\n");
}

// One free-text assistant reply for the conversation as it stands — shared
// by sendChatMessage and the follow-up after a granted readCourse. Course
// content is limited to accessibleCourseIdsFor; every other course appears
// by name only.
async function generateConversationReply(
  conversation: ChatConversation,
  messages: ChatMessage[],
  courses: Course[],
  options: {
    images?: { base64: string; mimeType: string }[];
    extraSystem?: string;
    onDelta?: (text: string) => void;
  } = {}
): Promise<string> {
  const { aiEfficiencyMode: efficient, cliTrustedModeEnabled } = await getAppSettings();
  const images = options.images ?? [];
  const accessibleIds = accessibleCourseIdsFor(conversation, messages, courses);
  const accessible = new Set(accessibleIds);

  let system = SYSTEM_PROMPT;
  let documentIds: number[] | undefined;

  const otherCourses = courses.filter((c) => !accessible.has(c.id));
  if (otherCourses.length > 0) {
    system += `\n\nThe user's other courses (names only — you can't see inside them unless the user grants access, which you'd ask for by telling them which course you'd need to read):\n${otherCourses.map((c) => `- ${c.name}`).join("\n")}`;
  }

  if (accessibleIds.length > 0) {
    const backendId = await resolveBackendId(images.length > 0);
    const useCliWorkspace = (backendId === "claude_code" || backendId === "codex_cli") && cliTrustedModeEnabled;

    if (useCliWorkspace) {
      // The materializer (see aiBackends/cliWorkspace.ts) writes every
      // document's real bytes regardless of status, so passing every id
      // here (not just extracted ones) satisfies "include all documents".
      documentIds = (await Promise.all(accessibleIds.map((id) => listDocumentsForCourse(id)))).flat().map((d) => d.id);
    } else {
      const query = retrievalQuery(messages);
      const sections = await Promise.all(
        accessibleIds.map(async (id) => {
          const { courseName, text } = await buildChatCourseContext(id, query);
          return `=== Course: ${courseName} ===\n${text}`;
        })
      );
      system += `\n\nThe user has made the following course material available in this conversation (the course it's scoped to and/or courses they allowed you to read) — use it to answer questions about those courses, but you can still discuss anything else too. Large courses are shown as an outline plus only the excerpts relevant to the latest message, not in full: if a question needs material you can't see, say which document or topic you'd need and ask the user to name it, rather than guessing.\n\n${sections.join("\n\n")}`;
    }
  }
  if (options.extraSystem) system += `\n\n${options.extraSystem}`;

  const params = {
    system,
    user: buildTranscriptPrompt(messages),
    maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
    effort: efficient ? ("low" as const) : ("medium" as const),
    efficient,
    images: images.length > 0 ? images : undefined,
    workspaceScope: documentIds?.length ? { documentIds } : undefined,
  };
  const reply = options.onDelta ? await streamText(params, options.onDelta) : await generateText(params);
  return stripOrphanMathDelimiters(reply.trim());
}

export class PendingActionNotFoundError extends Error {
  constructor() {
    super("No pending action found for this message.");
    this.name = "PendingActionNotFoundError";
  }
}

export type ResolvedPendingAction = ChatMessage & {
  // When a confirmed action granted read access to a course, the assistant's
  // answer to the request that prompted it, now that it can see the course.
  // null for everything else (and if that follow-up reply itself failed —
  // the user can simply ask again).
  followUp: ChatMessage | null;
};

// Confirms or cancels a proposed course action (see sendChatMessage) — the
// one place these actions actually execute. Re-validates everything
// against the current database state at execution time (see
// chatActions.ts's executeChatActions), since courses/folders/attachments
// could have changed since the action was proposed.
export async function resolvePendingAction(
  conversationId: number,
  messageId: number,
  confirm: boolean
): Promise<ResolvedPendingAction> {
  const message = await getChatMessage(messageId);
  if (!message || message.conversationId !== conversationId || !message.pendingAction) {
    throw new PendingActionNotFoundError();
  }
  // Already resolved (double-click, stale UI reload) — return as-is rather
  // than erroring or executing a second time.
  if (message.pendingAction.status !== "pending") {
    return { ...message, followUp: null };
  }

  if (!confirm) {
    const cancelled: PendingChatAction = { ...message.pendingAction, status: "cancelled" };
    await updateChatMessagePendingAction(messageId, cancelled);
    return { ...message, pendingAction: cancelled, followUp: null };
  }

  await updateChatMessagePendingAction(messageId, { ...message.pendingAction, status: "confirmed_executing" });

  const detail = await getChatConversation(conversationId);
  if (!detail) {
    const failed: PendingChatAction = {
      ...message.pendingAction,
      status: "failed",
      resultSummary: "This conversation no longer exists.",
    };
    await updateChatMessagePendingAction(messageId, failed);
    return { ...message, pendingAction: failed, followUp: null };
  }

  const availableAttachments = buildAvailableAttachmentsList(detail.messages);
  const resultSummary = await executeChatActions(
    detail.conversation.courseId,
    message.pendingAction.actions,
    availableAttachments
  );
  const resolved: PendingChatAction = { ...message.pendingAction, status: "executed", resultSummary };
  await updateChatMessagePendingAction(messageId, resolved);

  const resolvedMessage: ChatMessage = { ...message, pendingAction: resolved };
  const followUp = message.pendingAction.actions.some((a) => a.action === "readCourse")
    ? await answerAfterGrant(conversationId, resolvedMessage)
    : null;
  return { ...resolvedMessage, followUp };
}

// The user said yes to reading a course in response to some request — now
// answer that request with the course visible, instead of making them ask
// again. Best-effort: a backend failure here just means no follow-up.
async function answerAfterGrant(conversationId: number, resolvedMessage: ChatMessage): Promise<ChatMessage | null> {
  try {
    const detail = await getChatConversation(conversationId);
    if (!detail) return null;
    const courses = await listCourses();
    const reply = await generateConversationReply(
      detail.conversation,
      // The history as it stands, with the resolved proposal in place of the
      // pending one the database copy may still show.
      detail.messages.map((m) => (m.id === resolvedMessage.id ? resolvedMessage : m)),
      courses,
      {
        extraSystem:
          "The user just allowed you to read the course(s) above. Now answer the request that led you to ask — don't mention the permission step again.",
      }
    );
    return await addChatMessage(conversationId, "assistant", reply);
  } catch (err) {
    console.error("Follow-up reply after a course read grant failed:", err);
    return null;
  }
}
