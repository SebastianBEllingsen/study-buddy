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
 * folderId narrows further to a single folder within the course; omitted (or
 * null), it uses every folder in the course. Either way the boundary never
 * crosses a course — folderId only narrows, it never widens past courseId.
 *
 * Picking a parent folder pools it with its own subfolders (documents filed
 * directly in the parent, plus every one of its subfolders) — picking a
 * subfolder itself stays an exact match, since subfolders have no children
 * of their own to pool. See the plan for the "Tests > Test1/Test2" example
 * this exists for.
 */
export async function buildCourseContext(
  courseId: number,
  folderId?: number | null
): Promise<CourseContext> {
  const course = await getCourse(courseId);
  if (!course) {
    throw new Error(`Course ${courseId} not found`);
  }

  let scopeLabel = "All material";
  let folderIds: number[] | null = null;
  if (folderId != null) {
    const folder = await getFolder(folderId);
    if (!folder || folder.course_id !== courseId) {
      throw new Error(`Folder ${folderId} not found in course ${courseId}`);
    }
    const subfolderIds = (await listFoldersForCourse(courseId))
      .filter((f) => f.parent_folder_id === folderId)
      .map((f) => f.id);
    folderIds = [folderId, ...subfolderIds];
    scopeLabel = subfolderIds.length > 0 ? `${folder.name} (incl. subfolders)` : folder.name;
  }

  const documents = (await listDocumentsForCourse(courseId)).filter(
    (d) =>
      d.status === "extracted" &&
      d.extracted_text &&
      (folderIds == null || folderIds.includes(d.folder_id))
  );

  const combinedText = combineDocumentText(documents);

  const estimatedTokens = estimateTokens(combinedText);

  return {
    courseId,
    courseName: course.name,
    folderId: folderId ?? null,
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
