import { generateStructured } from "./aiClient";
import { createCourse, createFolder, createNote, getCourse, getFolder } from "./models";
import type { ChatAction, ChatAttachment, ChatMessage, Course, Folder } from "./models";
import { parseDataUrlImage } from "./dataUrlImage";
import { extFromMimeType } from "./aiBackends/cliWorkspace";
import { ingestDocumentBytes } from "./documentIngest";
import { folderPathLabel } from "./folderTree";

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

// Enough for "a course, a few folders, and a note or two in each" in one
// confirmation, without letting a single reply queue up an unbounded batch.
const MAX_ACTIONS = 12;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_COURSE_NAME_LENGTH = 100;
const MAX_NOTE_TITLE_LENGTH = 200;
const MAX_NOTE_MARKDOWN_LENGTH = 30_000;

export type KnownCourse = Pick<Course, "id" | "name">;

// What sanitizeAction is allowed to accept — everything the model's raw
// JSON gets checked against.
interface SanitizeContext {
  availableRefs: Set<string>;
  // Every course that exists (what an explicit courseId may name).
  courseIds: Set<number>;
  // Courses whose content the assistant can already see (scoped + granted):
  // a readCourse for one of these is pointless, and its folder ids are the
  // only ones the model was shown.
  accessibleCourseIds: Set<number>;
  folderIds: Set<number>;
  // True once a course target exists for actions that don't name one: the
  // conversation's own course, or a createCourse earlier in the batch.
  hasDefaultCourse: boolean;
}

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

function sanitizeBoundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

// An explicit courseId must name a real course; anything else collapses to
// null ("the default target"). Returns undefined when the model named a
// course that doesn't exist, so the caller can drop the action instead of
// silently redirecting it somewhere the user didn't confirm.
function sanitizeTargetCourse(raw: unknown, ctx: SanitizeContext): number | null | undefined {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && ctx.courseIds.has(raw)) return raw;
  return undefined;
}

// Never trusts the model's raw JSON directly — every field is re-checked
// against what's actually available (a real attachment ref in this
// conversation, a real course/folder id) before an action is allowed to
// exist at all, let alone execute. Executing re-checks again against the
// database (see executeChatActions).
function sanitizeAction(raw: unknown, ctx: SanitizeContext): ChatAction | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;

  if (a.action === "createCourse") {
    const courseName = sanitizeBoundedString(a.courseName, MAX_COURSE_NAME_LENGTH);
    if (!courseName) return null;
    // Whatever follows in this batch defaults to the new course.
    ctx.hasDefaultCourse = true;
    return { action: "createCourse", courseName };
  }

  if (a.action === "readCourse") {
    if (typeof a.courseId !== "number" || !ctx.courseIds.has(a.courseId)) return null;
    if (ctx.accessibleCourseIds.has(a.courseId)) return null;
    return { action: "readCourse", courseId: a.courseId };
  }

  if (a.action !== "createFolder" && a.action !== "createNote" && a.action !== "saveAttachment") return null;

  const courseId = sanitizeTargetCourse(a.courseId, ctx);
  if (courseId === undefined) return null;
  if (courseId === null && !ctx.hasDefaultCourse) return null;

  if (a.action === "createFolder") {
    const folderName = sanitizeFolderName(a.folderName);
    return folderName ? { action: "createFolder", folderName, courseId } : null;
  }

  const newFolderName = sanitizeFolderName(a.newFolderName);
  const folderId =
    typeof a.folderId === "number" && Number.isInteger(a.folderId) && ctx.folderIds.has(a.folderId)
      ? a.folderId
      : null;

  if (a.action === "createNote") {
    const title = sanitizeBoundedString(a.title, MAX_NOTE_TITLE_LENGTH);
    if (!title || typeof a.markdown !== "string") return null;
    const markdown = a.markdown.slice(0, MAX_NOTE_MARKDOWN_LENGTH);
    // A note may also live directly on the course page, so no destination
    // is fine; if both are set, the new folder wins (same as saveAttachment).
    return newFolderName
      ? { action: "createNote", title, markdown, folderId: null, newFolderName, courseId }
      : { action: "createNote", title, markdown, folderId, newFolderName: null, courseId };
  }

  if (typeof a.ref !== "string" || !ctx.availableRefs.has(a.ref)) return null;
  // Exactly one destination — prefer a new folder if the model somehow
  // set both, since "create X and save there" is the more specific ask.
  if (newFolderName) return { action: "saveAttachment", ref: a.ref, folderId: null, newFolderName, courseId };
  if (folderId != null) return { action: "saveAttachment", ref: a.ref, folderId, newFolderName: null, courseId };
  return null;
}

// Drops a standalone createFolder action whose name exactly matches a
// newFolderName a saveAttachment action in the same batch already creates —
// observed in practice: the model sometimes proposes both "create folder X"
// and "save the file into new folder X" for what's really one request,
// which would otherwise create two folders named X and orphan one of them.
function dedupeRedundantCreateFolder(actions: ChatAction[]): ChatAction[] {
  const key = (courseId: number | null | undefined, name: string) => `${courseId ?? ""}:${name}`;
  const namesCreatedElsewhere = new Set<string>();
  for (const a of actions) {
    if ((a.action === "saveAttachment" || a.action === "createNote") && a.newFolderName !== null) {
      namesCreatedElsewhere.add(key(a.courseId, a.newFolderName));
    }
  }
  return actions.filter(
    (a) => !(a.action === "createFolder" && namesCreatedElsewhere.has(key(a.courseId, a.folderName)))
  );
}

function sanitizeDetectedActions(raw: unknown, ctx: SanitizeContext): DetectedActions {
  if (!raw || typeof raw !== "object") return { actions: [], confirmationMessage: null };
  const r = raw as Record<string, unknown>;

  // Sequential on purpose: sanitizeAction tracks whether a createCourse
  // earlier in the batch gives later actions a default course.
  const sanitized: ChatAction[] = [];
  if (Array.isArray(r.actions)) {
    for (const rawAction of r.actions) {
      const action = sanitizeAction(rawAction, ctx);
      if (action) sanitized.push(action);
    }
  }
  const actions = dedupeRedundantCreateFolder(sanitized).slice(0, MAX_ACTIONS);

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
// latest message requests creating course content or reading a course.
// Failure here (backend error, bad JSON even after the backend's own retry)
// is swallowed rather than propagated — this is a bonus capability layered
// on top of chat, and must never block the normal conversational reply.
//
// Privacy: `courses` is names only. A course's folders (`folders`) are only
// passed for courses the assistant can already see — the one scoped to this
// conversation plus any the user granted via a confirmed readCourse — so
// nothing else about a course reaches the model before the user says yes.
export async function detectChatActions(params: {
  transcript: string;
  availableAttachments: AvailableAttachment[];
  courses: KnownCourse[];
  scopedCourseId: number | null;
  accessibleCourseIds: number[];
  folders: Folder[];
}): Promise<DetectedActions> {
  const accessible = new Set(params.accessibleCourseIds);
  const ctx: SanitizeContext = {
    availableRefs: new Set(params.availableAttachments.map((a) => a.ref)),
    courseIds: new Set(params.courses.map((c) => c.id)),
    accessibleCourseIds: accessible,
    folderIds: new Set(params.folders.map((f) => f.id)),
    hasDefaultCourse: params.scopedCourseId != null,
  };

  const courseList = params.courses.length
    ? params.courses
        .map((c) => {
          const tags = [
            c.id === params.scopedCourseId ? "this conversation's course" : null,
            accessible.has(c.id) ? "content already visible" : "content NOT visible",
          ].filter(Boolean);
          return `- id ${c.id}: "${c.name}" (${tags.join(", ")})`;
        })
        .join("\n")
    : "(none yet)";
  const folderList = params.folders.length
    ? // Full paths ("Parent / Child"), so same-named folders nested in
      // different places stay distinguishable.
      params.folders
        .map((f) => `- id ${f.id} (course ${f.course_id}): "${folderPathLabel(params.folders, f.id)}"`)
        .join("\n")
    : "(none)";
  const attachmentList = params.availableAttachments.length
    ? params.availableAttachments.map((a) => `- ref "${a.ref}": ${a.type} "${a.filename}"`).join("\n")
    : "(none)";

  const system = `You are a strict intent classifier for a study app, running alongside a friendly chat assistant. Given the conversation transcript below, decide whether the user's LATEST message asks to create course content (a course, folders, notes), save an already-attached file into a folder, or look at the content of a course the assistant cannot currently see.

Courses in the app:
${courseList}

Folders in courses whose content is visible:
${folderList}

Attachments already in this conversation:
${attachmentList}

Respond with ONLY a JSON object shaped exactly like:
{"actions": [...], "confirmationMessage": "..." | null}

Each entry in "actions" is one of:
{"action":"createCourse","courseName":"..."}
{"action":"createFolder","folderName":"...","courseId":<course id>|null}
{"action":"createNote","title":"...","markdown":"<the full note body in Markdown>","folderId":<an existing folder id from above>|null,"newFolderName":"..."|null,"courseId":<course id>|null}
{"action":"saveAttachment","ref":"<one of the refs listed above>","folderId":<an existing folder id from above>|null,"newFolderName":"..."|null,"courseId":<course id>|null}
{"action":"readCourse","courseId":<id of a course whose content is NOT visible>}

Rules:
- "courseId" on createFolder/createNote/saveAttachment is null to mean "the course created by an earlier createCourse in this same list, otherwise this conversation's course". Set it to an existing course id only when the user clearly means that other course. If there is neither a createCourse in the list nor a conversation course, you must name a course id or propose a createCourse first.
- When creating a new course with content, put the createCourse action FIRST, then its folders and notes.
- For createNote, write genuinely useful, well-structured Markdown (use LaTeX $...$ for math). Note titles must be unique across the whole app — make them specific. Set at most one of folderId/newFolderName; leave both null to put the note directly on the course page.
- For "saveAttachment", set exactly one of folderId/newFolderName (leave the other null).
- Only propose "readCourse" when answering the user's latest message genuinely requires the content of a course marked "content NOT visible" (or they explicitly ask you to look at it). Never for a course whose content is already visible, and never to browse courses speculatively.

If the latest message doesn't request any of this, respond with exactly {"actions": [], "confirmationMessage": null}.

Otherwise, include 1-${MAX_ACTIONS} actions and a SHORT, friendly confirmationMessage describing exactly what you're about to do (name each course, folder and note, and for a readCourse say which course you want to read and why), ending in a question asking the user to confirm (for example: "I'll create a course called \\"Sample Course\\" with a folder \\"Week 1\\" and a note \\"Key ideas\\" — want me to go ahead?"). Never claim the action is already done — you are only proposing it, nothing happens until the user confirms.`;

  let raw: unknown;
  try {
    raw = await generateStructured<unknown>({
      system,
      user: params.transcript,
      maxTokens: 4000,
      effort: "low",
      efficient: true,
    });
  } catch {
    return { actions: [], confirmationMessage: null };
  }

  return sanitizeDetectedActions(raw, ctx);
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
// — courses/folders/attachments could have changed between when the action
// was proposed and when the user confirmed it. Returns one deterministic,
// human-readable summary built by this function, never by the model (which
// can't know at generation time whether anything actually succeeded).
//
// `conversationCourseId` is the course the conversation is scoped to, if
// any — the fallback target for actions that don't name a course and
// weren't preceded by a createCourse in the same batch.
export async function executeChatActions(
  conversationCourseId: number | null,
  actions: ChatAction[],
  availableAttachments: AvailableAttachment[]
): Promise<string> {
  const attachmentByRef = new Map(availableAttachments.map((a) => [a.ref, a]));
  const summaries: string[] = [];
  let createdCourseId: number | null = null;
  // One folder per (course, name) per batch: several notes proposed into the
  // same brand-new folder must share it instead of each creating a copy.
  const createdFolders = new Map<string, Folder>();

  async function ensureFolder(courseId: number, name: string): Promise<{ folder: Folder }> {
    const key = `${courseId}:${name}`;
    const existing = createdFolders.get(key);
    if (existing) return { folder: existing };
    const folder = await createFolder(courseId, name);
    createdFolders.set(key, folder);
    return { folder };
  }

  for (const action of actions) {
    try {
      if (action.action === "createCourse") {
        const course = await createCourse(action.courseName);
        createdCourseId = course.id;
        summaries.push(`Created course "${course.name}".`);
        continue;
      }

      if (action.action === "readCourse") {
        const course = await getCourse(action.courseId);
        summaries.push(
          course
            ? `Allowed to read "${course.name}" in this conversation.`
            : "Couldn't read that course — it no longer exists."
        );
        continue;
      }

      const courseId = action.courseId ?? createdCourseId ?? conversationCourseId;
      if (courseId == null || !(await getCourse(courseId))) {
        summaries.push("Couldn't do that — there's no course to put it in.");
        continue;
      }

      if (action.action === "createFolder") {
        const { folder } = await ensureFolder(courseId, action.folderName);
        summaries.push(`Created folder "${folder.name}".`);
        continue;
      }

      const available = action.action === "saveAttachment" ? attachmentByRef.get(action.ref) : undefined;
      if (action.action === "saveAttachment" && !available) {
        summaries.push("Couldn't save that attachment — it's no longer available.");
        continue;
      }

      let folderId: number | null;
      let folderName: string | null;
      if (action.newFolderName) {
        const { folder } = await ensureFolder(courseId, action.newFolderName);
        folderId = folder.id;
        folderName = folder.name;
      } else if (action.folderId != null) {
        const folder = await getFolder(action.folderId);
        if (!folder || folder.course_id !== courseId) {
          summaries.push(
            `Couldn't ${action.action === "createNote" ? `create "${action.title}"` : "save that file"} — that folder no longer exists.`
          );
          continue;
        }
        folderId = folder.id;
        folderName = folder.name;
      } else {
        folderId = null;
        folderName = null;
      }

      if (action.action === "createNote") {
        const note = await createNote(action.title, courseId, folderId, action.markdown);
        summaries.push(`Created note "${note.title}"${folderName ? ` in "${folderName}"` : ""}.`);
        continue;
      }

      if (!available) continue;
      if (folderId == null) {
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
