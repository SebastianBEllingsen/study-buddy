import { generateStructured } from "./aiClient";
import { createFolder, getFolder } from "./models";
import type { ChatAction, ChatAttachment, ChatMessage, Folder } from "./models";
import { parseDataUrlImage } from "./dataUrlImage";
import { extFromMimeType } from "./aiBackends/cliWorkspace";
import { ingestDocumentBytes } from "./documentIngest";

export interface AvailableAttachment {
  // "m<messageId>-<attachmentIndex>" — a compact identifier the model can
  // reference reliably in its structured output, instead of two separate
  // numeric fields.
  ref: string;
  filename: string;
  type: ChatAttachment["type"];
  data: ChatAttachment;
}

export interface DetectedActions {
  actions: ChatAction[];
  confirmationMessage: string | null;
}

const MAX_ACTIONS = 3;
const MAX_FOLDER_NAME_LENGTH = 100;

// Walks every message's attachments (not just the latest one) so the model
// can resolve a reference like "the file I sent earlier" to something
// attached several turns back in the same conversation.
export function buildAvailableAttachmentsList(messages: ChatMessage[]): AvailableAttachment[] {
  const result: AvailableAttachment[] = [];
  for (const m of messages) {
    (m.attachments ?? []).forEach((a, index) => {
      result.push({ ref: `m${m.id}-${index}`, filename: a.filename, type: a.type, data: a });
    });
  }
  return result;
}

function sanitizeFolderName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
  return trimmed || null;
}

// Never trusts the model's raw JSON directly — every field is re-checked
// against what's actually available (a real attachment ref in this
// conversation, a real folder id in this course) before an action is
// allowed to exist at all, let alone execute.
function sanitizeAction(raw: unknown, availableRefs: Set<string>, folderIds: Set<number>): ChatAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;

  if (a.action === "createFolder") {
    const folderName = sanitizeFolderName(a.folderName);
    return folderName ? { action: "createFolder", folderName } : null;
  }

  if (a.action === "saveAttachment") {
    if (typeof a.ref !== "string" || !availableRefs.has(a.ref)) return null;
    const newFolderName = sanitizeFolderName(a.newFolderName);
    const folderId =
      typeof a.folderId === "number" && Number.isInteger(a.folderId) && folderIds.has(a.folderId)
        ? a.folderId
        : null;
    // Exactly one destination — prefer a new folder if the model somehow
    // set both, since "create X and save there" is the more specific ask.
    if (newFolderName) return { action: "saveAttachment", ref: a.ref, folderId: null, newFolderName };
    if (folderId != null) return { action: "saveAttachment", ref: a.ref, folderId, newFolderName: null };
    return null;
  }

  return null;
}

// Drops a standalone createFolder action whose name exactly matches a
// newFolderName a saveAttachment action in the same batch already creates —
// observed in practice: the model sometimes proposes both "create folder X"
// and "save the file into new folder X" for what's really one request,
// which would otherwise create two folders named X and orphan one of them.
function dedupeRedundantCreateFolder(actions: ChatAction[]): ChatAction[] {
  const namesCreatedElsewhere = new Set(
    actions
      .filter((a): a is Extract<ChatAction, { action: "saveAttachment" }> => a.action === "saveAttachment")
      .map((a) => a.newFolderName)
      .filter((name): name is string => name !== null)
  );
  return actions.filter((a) => !(a.action === "createFolder" && namesCreatedElsewhere.has(a.folderName)));
}

function sanitizeDetectedActions(raw: unknown, availableRefs: Set<string>, folderIds: Set<number>): DetectedActions {
  if (!raw || typeof raw !== "object") return { actions: [], confirmationMessage: null };
  const r = raw as Record<string, unknown>;

  const actions = Array.isArray(r.actions)
    ? dedupeRedundantCreateFolder(
        r.actions
          .map((a) => sanitizeAction(a, availableRefs, folderIds))
          .filter((a): a is ChatAction => a !== null)
      ).slice(0, MAX_ACTIONS)
    : [];

  // No actions survive validation without a confirmation message to show —
  // and no message is shown without at least one real action behind it.
  const confirmationMessage =
    actions.length > 0 && typeof r.confirmationMessage === "string" && r.confirmationMessage.trim()
      ? r.confirmationMessage.trim()
      : null;

  return confirmationMessage ? { actions, confirmationMessage } : { actions: [], confirmationMessage: null };
}

// One small, cheap generateStructured call (same JSON-extraction idiom used
// throughout this app — quiz/notes/flashcards) deciding whether the user's
// latest message requests a folder/save action. Failure here (backend
// error, bad JSON even after the backend's own retry) is swallowed rather
// than propagated — this is a bonus capability layered on top of chat, and
// must never block the normal conversational reply.
export async function detectChatActions(params: {
  transcript: string;
  availableAttachments: AvailableAttachment[];
  folders: Folder[];
}): Promise<DetectedActions> {
  const folderIds = new Set(params.folders.map((f) => f.id));
  const availableRefs = new Set(params.availableAttachments.map((a) => a.ref));

  const folderList = params.folders.length
    ? params.folders.map((f) => `- id ${f.id}: "${f.name}"`).join("\n")
    : "(none yet)";
  const attachmentList = params.availableAttachments.length
    ? params.availableAttachments.map((a) => `- ref "${a.ref}": ${a.type} "${a.filename}"`).join("\n")
    : "(none)";

  const system = `You are a strict intent classifier for a study app's course file management, running alongside a friendly chat assistant. Given the conversation transcript below, decide whether the user's LATEST message asks to create a folder and/or save an already-attached file into a folder.

Existing folders in this course:
${folderList}

Attachments already in this conversation:
${attachmentList}

Respond with ONLY a JSON object shaped exactly like:
{"actions": [...], "confirmationMessage": "..." | null}

Each entry in "actions" is one of:
{"action":"createFolder","folderName":"..."}
{"action":"saveAttachment","ref":"<one of the refs listed above>","folderId":<an existing folder id from above>|null,"newFolderName":"..."|null}

For "saveAttachment", set exactly one of folderId/newFolderName (leave the other null) — folderId to save into an existing folder, or newFolderName to create a new one first and save there.

If the latest message doesn't request any folder/save action, respond with exactly {"actions": [], "confirmationMessage": null}.

Otherwise, include 1-3 actions and a SHORT, friendly confirmationMessage describing exactly what you're about to do, ending in a question asking the user to confirm (for example: "I'll create a folder called \\"Diagrams\\" and save photo.png there — want me to go ahead?"). Never claim the action is already done — you are only proposing it, nothing happens until the user confirms.`;

  let raw: unknown;
  try {
    raw = await generateStructured<unknown>({
      system,
      user: params.transcript,
      maxTokens: 400,
      effort: "low",
      efficient: true,
    });
  } catch {
    return { actions: [], confirmationMessage: null };
  }

  return sanitizeDetectedActions(raw, availableRefs, folderIds);
}

function decodeAttachmentBytes(a: ChatAttachment): { buffer: Buffer; filename: string } {
  if (a.type === "document") {
    return { buffer: Buffer.from(a.fileBase64, "base64"), filename: a.filename };
  }
  const parsed = parseDataUrlImage(a.dataUrl);
  if (!parsed) throw new Error("couldn't decode this image");
  // The extension comes from the attachment's own mimeType, not the
  // (client-supplied, not fully trustworthy) filename — same reasoning as
  // aiBackends/cliWorkspace.ts's inline-file handling.
  const base = a.filename.replace(/\.[^./]+$/, "") || "image";
  return { buffer: Buffer.from(parsed.base64, "base64"), filename: `${base}.${extFromMimeType(parsed.mimeType)}` };
}

// Re-validates everything against the CURRENT database state before acting
// — folders/attachments could have changed between when the action was
// proposed and when the user confirmed it. Returns one deterministic,
// human-readable summary built by this function, never by the model (which
// can't know at generation time whether anything actually succeeded).
export async function executeChatActions(
  courseId: number,
  actions: ChatAction[],
  availableAttachments: AvailableAttachment[]
): Promise<string> {
  const attachmentByRef = new Map(availableAttachments.map((a) => [a.ref, a]));
  const summaries: string[] = [];

  for (const action of actions) {
    try {
      if (action.action === "createFolder") {
        const folder = await createFolder(courseId, action.folderName);
        summaries.push(`Created folder "${folder.name}".`);
        continue;
      }

      const available = attachmentByRef.get(action.ref);
      if (!available) {
        summaries.push("Couldn't save that attachment — it's no longer available.");
        continue;
      }

      let folderId: number;
      let folderName: string;
      if (action.newFolderName) {
        const folder = await createFolder(courseId, action.newFolderName);
        folderId = folder.id;
        folderName = folder.name;
      } else if (action.folderId != null) {
        const folder = await getFolder(action.folderId);
        if (!folder || folder.course_id !== courseId) {
          summaries.push(`Couldn't save "${available.filename}" — that folder no longer exists.`);
          continue;
        }
        folderId = folder.id;
        folderName = folder.name;
      } else {
        summaries.push(`Couldn't save "${available.filename}" — no destination folder was specified.`);
        continue;
      }

      const { buffer, filename } = decodeAttachmentBytes(available.data);
      await ingestDocumentBytes({ courseId, folderId, filename, buffer });
      summaries.push(`Saved "${filename}" to "${folderName}".`);
    } catch (err) {
      summaries.push(`Something went wrong: ${err instanceof Error ? err.message : "unknown error"}.`);
    }
  }

  return summaries.length > 0 ? summaries.join(" ") : "Nothing to do.";
}
