import { getCourse, getFolder, listDocumentsForCourse, listFoldersForCourse, listNotesForCourse } from "./models";
import type { DocumentRow, Note } from "./models";
import { estimateTokens, CHUNK_THRESHOLD_TOKENS, chunkText } from "./chunking";
import { omitEmbeddedImages } from "./embeddedImages";
import { descendantFolderIds, folderPathLabel } from "./folderTree";
import { stripNoteLinkSyntax } from "./noteLinks";
import type { SourceTrust } from "./sources/types";
import type { SourceRef } from "./types";
export { resolveSourceName } from "./sources/names";

// One labelled section of generation material: a course document, or a
// Vault note the student opted into generation (notes.generation_source).
export interface ContextSource {
  kind: SourceRef["kind"];
  id: number;
  title: string;
  trust: SourceTrust;
  text: string;
}

const TRUST_LABELS: Record<SourceTrust, string> = {
  official: "authoritative material",
  personal: "personal notes",
};

// The section header the prompts refer to: kind, name, and trust — e.g.
// "--- Document: chapter-3.pdf [authoritative material] ---". Items name
// their source by the text between ": " and " [" (see resolveSourceName).
export function sourceHeader(source: Pick<ContextSource, "kind" | "title" | "trust">): string {
  return `--- ${source.kind === "note" ? "Note" : "Document"}: ${source.title} [${TRUST_LABELS[source.trust]}] ---`;
}

export function combineSources(sources: ContextSource[]): string {
  return sources.map((s) => `${sourceHeader(s)}\n${s.text}`).join("\n\n");
}

export function documentSource(d: DocumentRow): ContextSource {
  return {
    kind: "document",
    id: d.id,
    title: d.filename,
    trust: d.trust ?? "official",
    text: omitEmbeddedImages(d.extracted_text ?? ""),
  };
}

export function noteSource(n: Note, trust: SourceTrust): ContextSource {
  return {
    kind: "note",
    id: n.id,
    title: n.title,
    trust,
    text: omitEmbeddedImages(stripNoteLinkSyntax(n.markdown)),
  };
}

export function combineDocumentText(documents: DocumentRow[]): string {
  return combineSources(documents.map(documentSource));
}

export interface CourseContext {
  courseId: number;
  courseName: string;
  folderId: number | null;
  // True for a hand-picked "choose documents" selection — folderId is also
  // null in this case (no single folder), but the two need to stay
  // distinguishable; see getNewDocumentsForItem in models.ts.
  handpicked: boolean;
  scopeLabel: string;
  documentIds: number[];
  // Vault notes included because they're marked for generation.
  noteIds: number[];
  // Every section in combinedText, for resolving the source each
  // generated card/question names.
  sources: SourceRef[];
  combinedText: string;
  estimatedTokens: number;
  needsChunking: boolean;
}

/**
 * The ONLY function allowed to read across a course's documents and combine
 * their extracted text. Every generation/grading call goes through here with
 * a mandatory courseId — there is no "all documents" query anywhere else, so
 * one course's material structurally cannot leak into another's prompt.
 *
 * options.folderId narrows to a single folder within the course; options.
 * documentIds narrows to an exact, hand-picked set of documents instead
 * (independent of folder — a custom pick can span several). documentIds
 * wins if both are given. Neither ever widens past courseId: documentIds is
 * always intersected with this course's own extracted documents, so passing
 * an id from a different course just silently drops it rather than leaking
 * that document's text in here.
 *
 * Picking a folder pools it with every subfolder nested under it, at any
 * depth (documents filed directly in it, plus everything in its subtree) —
 * a folder with no subfolders is just an exact match.
 *
 * Vault notes marked for generation join the same scope: all of the
 * course's, or those filed in the picked folder's subtree. A hand-picked
 * selection includes only the notes named in options.noteIds.
 */
export async function buildCourseContext(
  courseId: number,
  options?: { folderId?: number | null; documentIds?: number[] | null; noteIds?: number[] | null }
): Promise<CourseContext> {
  const course = await getCourse(courseId);
  if (!course) {
    throw new Error(`Course ${courseId} not found`);
  }

  const folderId = options?.folderId ?? null;
  const requestedDocumentIds = options?.documentIds ?? null;

  const [allDocuments, allNotes] = await Promise.all([listDocumentsForCourse(courseId), listNotesForCourse(courseId)]);
  const extracted = allDocuments.filter((d) => d.status === "extracted" && d.extracted_text);
  const generationNotes = allNotes.filter((n) => n.generation_source && n.markdown.trim());

  let scopeLabel = "All material";
  let documents: DocumentRow[];
  let notes: Note[];
  // A hand-picked selection means the result isn't filed under any single
  // folder — generateForCourse falls back to the course's default folder,
  // same as the "All course material" (folderId null) case below.
  let resolvedFolderId: number | null = null;
  let handpicked = false;

  const requestedNoteIds = options?.noteIds ?? null;
  if ((requestedDocumentIds && requestedDocumentIds.length > 0) || (requestedNoteIds && requestedNoteIds.length > 0)) {
    const idSet = new Set(requestedDocumentIds ?? []);
    const noteIdSet = new Set(requestedNoteIds ?? []);
    documents = extracted.filter((d) => idSet.has(d.id));
    notes = generationNotes.filter((n) => noteIdSet.has(n.id));
    // Actual filenames instead of just a count, so the item title says what
    // it was generated from — e.g. "(Lecture4.pdf, Lecture5.pdf)". Capped at
    // 3 named files to keep the title from running away on a big pick.
    const names = [...documents.map((d) => d.filename), ...notes.map((n) => n.title)];
    scopeLabel =
      names.length <= 3
        ? names.join(", ")
        : `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
    handpicked = true;
  } else if (folderId != null) {
    const folder = await getFolder(folderId);
    if (!folder || folder.course_id !== courseId) {
      throw new Error(`Folder ${folderId} not found in course ${courseId}`);
    }
    const subfolderIds = descendantFolderIds(await listFoldersForCourse(courseId), folderId);
    const folderIds = [folderId, ...subfolderIds];
    documents = extracted.filter((d) => d.folder_id !== null && folderIds.includes(d.folder_id));
    notes = generationNotes.filter((n) => n.folder_id !== null && folderIds.includes(n.folder_id));
    scopeLabel = subfolderIds.length > 0 ? `${folder.name} (incl. subfolders)` : folder.name;
    resolvedFolderId = folderId;
  } else {
    documents = extracted;
    notes = generationNotes;
  }

  const sections = [
    ...documents.map(documentSource),
    ...notes.map((n) => noteSource(n, n.generation_source as SourceTrust)),
  ];
  const combinedText = combineSources(sections);

  const estimatedTokens = estimateTokens(combinedText);

  return {
    courseId,
    courseName: course.name,
    folderId: resolvedFolderId,
    handpicked,
    scopeLabel,
    documentIds: documents.map((d) => d.id),
    noteIds: notes.map((n) => n.id),
    sources: sections.map(({ kind, id, title }) => ({ kind, id, title })),
    combinedText,
    estimatedTokens,
    needsChunking: estimatedTokens > CHUNK_THRESHOLD_TOKENS,
  };
}

export function chunkCourseContext(context: CourseContext): string[] {
  return chunkText(context.combinedText);
}

// A broader variant of buildCourseContext, used only by the general chat
// assistant's course-scoping (see chat.ts's sendChatMessage) when it needs
// to fold course context into the prompt as plain text instead of via a
// trusted-CLI workspace/manifest. Unlike buildCourseContext, this lists
// EVERY document in the course, not just status === "extracted" ones — a
// non-text document (an image, or one still pending/failed) still gets a
// placeholder line naming it, so the model at least knows it exists, per
// the "all documents" requirement this was built for. Deliberately doesn't
// touch buildCourseContext itself — quiz/flashcard/notes generation must
// keep their existing extracted-only behavior unchanged.
export async function buildFullCourseContextText(
  courseId: number
): Promise<{ courseName: string; text: string }> {
  const course = await getCourse(courseId);
  if (!course) {
    throw new Error(`Course ${courseId} not found`);
  }

  const [documents, folders] = await Promise.all([
    listDocumentsForCourse(courseId),
    listFoldersForCourse(courseId),
  ]);
  const folderIds = new Set(folders.map((f) => f.id));

  const sections = documents.map((d) => {
    const location =
      d.folder_id != null && folderIds.has(d.folder_id) ? folderPathLabel(folders, d.folder_id) : "Unfiled";
    if (d.status === "extracted" && d.extracted_text) {
      return `--- Document: ${d.filename} (${location}) ---\n${omitEmbeddedImages(d.extracted_text)}`;
    }
    const statusLabel = d.status === "image" ? "image, no extracted text" : d.status;
    return `--- Document: ${d.filename} (${location}, ${statusLabel}) ---`;
  });

  return { courseName: course.name, text: sections.join("\n\n") };
}
