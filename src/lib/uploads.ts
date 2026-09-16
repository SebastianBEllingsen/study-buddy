import fs from "node:fs";
import path from "node:path";

// Just the path, no side effect — used by deleteCourse's cleanup (see the
// course DELETE route), which must never conjure the directory back into
// existence right after removing it.
export function courseUploadsDirPath(courseId: number): string {
  return path.join(process.cwd(), "data", "uploads", String(courseId));
}

export function uploadsDir(courseId: number): string {
  const dir = courseUploadsDirPath(courseId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Where the LibreOffice-converted PDF for an odt/pptx document is cached on
// disk, next to its original file — regenerating it via LibreOffice on
// every view would mean a multi-second wait each time; this makes it a
// one-time cost (at upload, or on first view from a device that only has
// the synced original). Not itself synced across devices — a missing cache
// file just means the GET route regenerates and re-caches it locally.
export function previewPdfPath(originalFilePath: string): string {
  return `${originalFilePath}.preview.pdf`;
}
