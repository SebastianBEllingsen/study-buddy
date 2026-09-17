import { getCourse, getFolder, listDocumentsForCourse, listFoldersForCourse } from "./models";
import type { DocumentRow } from "./models";
import { estimateTokens, CHUNK_THRESHOLD_TOKENS, chunkText } from "./chunking";
import { omitEmbeddedImages } from "./embeddedImages";

export function combineDocumentText(documents: DocumentRow[]): string {
  return documents
    .map(
      (d) => `--- Document: ${d.filename} ---\n${omitEmbeddedImages(d.extracted_text ?? "")}`
    )
    .join("\n\n");
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
 * Picking a parent folder pools it with its own subfolders (documents filed
 * directly in the parent, plus every one of its subfolders) — picking a
 * subfolder itself stays an exact match, since subfolders have no children
 * of their own to pool. See the plan for the "Tests > Test1/Test2" example
 * this exists for.
 */
export async function buildCourseContext(
  courseId: number,
  options?: { folderId?: number | null; documentIds?: number[] | null }
): Promise<CourseContext> {
  const course = await getCourse(courseId);
  if (!course) {
    throw new Error(`Course ${courseId} not found`);
  }

  const folderId = options?.folderId ?? null;
  const requestedDocumentIds = options?.documentIds ?? null;

  const extracted = (await listDocumentsForCourse(courseId)).filter(
    (d) => d.status === "extracted" && d.extracted_text
  );

  let scopeLabel = "All material";
  let documents: DocumentRow[];
  // A hand-picked selection means the result isn't filed under any single
  // folder — generateForCourse falls back to the course's default folder,
  // same as the "All course material" (folderId null) case below.
  let resolvedFolderId: number | null = null;
  let handpicked = false;

  if (requestedDocumentIds && requestedDocumentIds.length > 0) {
    const idSet = new Set(requestedDocumentIds);
    documents = extracted.filter((d) => idSet.has(d.id));
    // Actual filenames instead of just a count, so the item title says what
    // it was generated from — e.g. "(Lecture4.pdf, Lecture5.pdf)". Capped at
    // 3 named files to keep the title from running away on a big pick.
    const names = documents.map((d) => d.filename);
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
    const subfolderIds = (await listFoldersForCourse(courseId))
      .filter((f) => f.parent_folder_id === folderId)
      .map((f) => f.id);
    const folderIds = [folderId, ...subfolderIds];
    documents = extracted.filter((d) => folderIds.includes(d.folder_id));
    scopeLabel = subfolderIds.length > 0 ? `${folder.name} (incl. subfolders)` : folder.name;
    resolvedFolderId = folderId;
  } else {
    documents = extracted;
  }

  const combinedText = combineDocumentText(documents);

  const estimatedTokens = estimateTokens(combinedText);

  return {
    courseId,
    courseName: course.name,
    folderId: resolvedFolderId,
    handpicked,
    scopeLabel,
    documentIds: documents.map((d) => d.id),
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
  const folderName = new Map(folders.map((f) => [f.id, f.name]));

  const sections = documents.map((d) => {
    const location = d.folder_id != null ? (folderName.get(d.folder_id) ?? "Unfiled") : "Unfiled";
    if (d.status === "extracted" && d.extracted_text) {
      return `--- Document: ${d.filename} (${location}) ---\n${omitEmbeddedImages(d.extracted_text)}`;
    }
    const statusLabel = d.status === "image" ? "image, no extracted text" : d.status;
    return `--- Document: ${d.filename} (${location}, ${statusLabel}) ---`;
  });

  return { courseName: course.name, text: sections.join("\n\n") };
}
