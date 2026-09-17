import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getCourse, getDocumentBytes, getDocumentsByIds, getFolder } from "../models";
import type { DocumentWithBytes } from "../models";
import { extensionOf } from "../documentFormats";

export interface WorkspaceInlineFile {
  filename: string;
  base64: string;
  mimeType: string;
}

export interface CliWorkspaceScope {
  documentIds?: number[];
  inlineFiles?: WorkspaceInlineFile[];
}

export interface CliWorkspaceHandle {
  dir: string;
  manifestPath: string;
  cleanup(): Promise<void>;
}

const WORKSPACE_ROOT = path.join(process.cwd(), "data", "ai-workspace");

// Collapses anything that isn't a safe path segment character down to "-" —
// used for both course/folder directory names and on-disk filenames, since
// course/folder names and uploaded filenames are all user-controlled text
// that must never be interpreted as ".." traversal or other path syntax.
function sanitizeSegment(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "untitled";
}

function extFromMimeType(mimeType: string): string {
  const sub = mimeType.includes("/") ? mimeType.slice(mimeType.indexOf("/") + 1) : mimeType;
  return sub.split("+")[0].replace(/[^a-zA-Z0-9]/g, "") || "bin";
}

interface ManifestDocument {
  id: number;
  filename: string;
  status: string;
  // Relative to the workspace dir (this manifest's own directory) — null
  // when there are no real bytes to read (a pasted-text "document", or one
  // whose file_path/file_base64 are both unavailable on this device).
  path: string | null;
}
interface ManifestFolder {
  id: number | null;
  name: string;
  documents: ManifestDocument[];
}
interface ManifestCourse {
  id: number;
  name: string;
  folders: ManifestFolder[];
}
interface ManifestAttachment {
  path: string;
  mimeType: string;
}
interface Manifest {
  generatedAt: string;
  courses: ManifestCourse[];
  attachments: ManifestAttachment[];
}

// Builds a disposable workspace directory for a trusted CLI subprocess (see
// aiBackends/claudeCode.ts / codexCli.ts, gated on AppSettings.cliTrustedModeEnabled)
// — real copies of the relevant course documents/images plus a manifest.json
// lookup table, in a throwaway directory that's never the app's own project
// tree, database, or .env.
//
// This is a curated *default scope* for convenience, not an OS-level jail:
// once cliTrustedModeEnabled unlocks Bash/network for the subprocess, true
// containment would need an OS sandbox profile (bubblewrap/Seatbelt), which
// is out of scope for this feature — see the warning copy in
// SettingsDialog.tsx, which is the actual informed-consent boundary here.
//
// Retention: a fresh subdirectory per call, removed via the returned
// cleanup() once the CLI subprocess exits (wrapped in try/finally by the
// caller) — not a longer-lived per-course cache, since documents can change
// between calls and concurrent generation calls (see generate.ts's
// CHUNK_CONCURRENCY) would otherwise race on a shared directory.
export async function materializeCliWorkspace(scope: CliWorkspaceScope): Promise<CliWorkspaceHandle> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  const dir = path.join(WORKSPACE_ROOT, crypto.randomUUID());
  await fs.mkdir(dir, { recursive: true });

  const manifest: Manifest = { generatedAt: new Date().toISOString(), courses: [], attachments: [] };

  const documentIds = scope.documentIds ?? [];
  if (documentIds.length > 0) {
    const docs = await getDocumentsByIds(documentIds);
    const byCourse = new Map<number, DocumentWithBytes[]>();
    for (const doc of docs) {
      const list = byCourse.get(doc.course_id) ?? [];
      list.push(doc);
      byCourse.set(doc.course_id, list);
    }

    for (const [courseId, courseDocs] of byCourse) {
      const course = await getCourse(courseId);
      const courseName = course?.name ?? `course-${courseId}`;
      const courseDirName = `course-${courseId}-${sanitizeSegment(courseName)}`;
      const manifestCourse: ManifestCourse = { id: courseId, name: courseName, folders: [] };

      const byFolder = new Map<number | null, DocumentWithBytes[]>();
      for (const doc of courseDocs) {
        const list = byFolder.get(doc.folder_id) ?? [];
        list.push(doc);
        byFolder.set(doc.folder_id, list);
      }

      for (const [folderId, folderDocs] of byFolder) {
        const folder = folderId !== null ? await getFolder(folderId) : undefined;
        const folderName = folder?.name ?? "root";
        const folderDirName = sanitizeSegment(folderName);
        const manifestFolder: ManifestFolder = { id: folderId, name: folderName, documents: [] };

        for (const doc of folderDocs) {
          // Pasted-text "documents" have no underlying file — their content
          // already lives in extracted_text (folded into the prompt text
          // elsewhere), so there's nothing to materialize.
          if (doc.file_path === "") {
            manifestFolder.documents.push({
              id: doc.id,
              filename: doc.filename,
              status: doc.status,
              path: null,
            });
            continue;
          }

          const bytes = await getDocumentBytes(doc);
          if (!bytes) {
            manifestFolder.documents.push({
              id: doc.id,
              filename: doc.filename,
              status: doc.status,
              path: null,
            });
            continue;
          }

          // The doc-id suffix makes the on-disk name collision-safe
          // structurally, not just by convention — filenames aren't
          // guaranteed unique within a folder (e.g. "slides.pdf" reused
          // across weeks).
          const ext = extensionOf(doc.filename);
          const base = sanitizeSegment(doc.filename.replace(/\.[^./]+$/, ""));
          const safeName = `${base}-${doc.id}${ext ? `.${ext}` : ""}`;
          const relDir = path.join("files", courseDirName, folderDirName);
          await fs.mkdir(path.join(dir, relDir), { recursive: true });
          const relPath = path.join(relDir, safeName);
          await fs.writeFile(path.join(dir, relPath), bytes);
          manifestFolder.documents.push({
            id: doc.id,
            filename: doc.filename,
            status: doc.status,
            path: relPath,
          });
        }

        manifestCourse.folders.push(manifestFolder);
      }

      manifest.courses.push(manifestCourse);
    }
  }

  if (scope.inlineFiles?.length) {
    const attachmentsDir = path.join(dir, "attachments");
    await fs.mkdir(attachmentsDir, { recursive: true });
    for (const [index, file] of scope.inlineFiles.entries()) {
      const ext = extFromMimeType(file.mimeType);
      const base = file.filename
        ? sanitizeSegment(file.filename.replace(/\.[^./]+$/, ""))
        : "image";
      const relPath = path.join("attachments", `${index + 1}-${base}.${ext}`);
      await fs.writeFile(path.join(dir, relPath), Buffer.from(file.base64, "base64"));
      manifest.attachments.push({ path: relPath, mimeType: file.mimeType });
    }
  }

  const manifestPath = path.join(dir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    dir,
    manifestPath,
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
