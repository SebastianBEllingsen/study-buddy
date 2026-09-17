import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import type { TestDb } from "../db/testHarness";

// materializeCliWorkspace pulls document/folder/course data from
// "../models", which itself resolves "./db" — mocked here to an in-memory
// SQLite database, same pattern as models.test.ts.
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return {
    db: testDb.db,
    runTransaction: testDb.runTransaction,
    ...testDb.schema,
  };
});

const { createCourse, createFolder, createDocument, markDocumentExtracted } = await import("../models");
const { materializeCliWorkspace } = await import("./cliWorkspace");

beforeEach(() => {
  const { db, schema } = testDb;
  db.delete(schema.documents).run();
  db.delete(schema.folders).run();
  db.delete(schema.courses).run();
});

interface ManifestShape {
  courses: {
    id: number;
    name: string;
    folders: { id: number | null; name: string; documents: { id: number; filename: string; path: string | null }[] }[];
  }[];
  attachments: { path: string; mimeType: string }[];
}

async function readManifest(manifestPath: string): Promise<ManifestShape> {
  return JSON.parse(await fs.readFile(manifestPath, "utf-8"));
}

describe("materializeCliWorkspace", () => {
  it("writes real document bytes and a manifest, then removes everything on cleanup", async () => {
    const course = await createCourse("Bio 101");
    const folder = await createFolder(course.id, "Week 1");
    const doc = await createDocument({
      courseId: course.id,
      folderId: folder.id,
      filename: "Lecture 1.pdf",
      filePath: "", // pasted-text style — no real file_path, but base64 present below
      fileBase64: Buffer.from("fake pdf bytes").toString("base64"),
    });
    await markDocumentExtracted({ id: doc.id, extractedText: "hello", pageCount: 1, charCount: 5 });

    const handle = await materializeCliWorkspace({ documentIds: [doc.id] });
    try {
      const manifest = await readManifest(handle.manifestPath);
      // file_path === "" means no bytes to materialize even though
      // file_base64 is set — see cliWorkspace.ts's pasted-text-document skip.
      expect(manifest.courses).toHaveLength(1);
      expect(manifest.courses[0].name).toBe("Bio 101");
      expect(manifest.courses[0].folders[0].documents[0]).toMatchObject({
        id: doc.id,
        filename: "Lecture 1.pdf",
        path: null,
      });
    } finally {
      await handle.cleanup();
    }

    await expect(fs.access(handle.dir)).rejects.toThrow();
  });

  it("gives two same-named documents distinct, collision-safe on-disk paths", async () => {
    const course = await createCourse("Bio 101");
    const folder = await createFolder(course.id, "Week 1");
    const path = await import("node:path");
    const os = await import("node:os");

    // A real on-disk file_path this time, so the "collision-safe naming"
    // behavior actually gets exercised (file_path === "" always skips
    // writing a file, per the test above).
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cliWorkspaceTest-"));
    const filePathA = path.join(tmpDir, "a.txt");
    const filePathB = path.join(tmpDir, "b.txt");
    await fs.writeFile(filePathA, "content A");
    await fs.writeFile(filePathB, "content B");

    const docA = await createDocument({
      courseId: course.id,
      folderId: folder.id,
      filename: "slides.pdf",
      filePath: filePathA,
      fileBase64: null,
    });
    const docB = await createDocument({
      courseId: course.id,
      folderId: folder.id,
      filename: "slides.pdf",
      filePath: filePathB,
      fileBase64: null,
    });

    const handle = await materializeCliWorkspace({ documentIds: [docA.id, docB.id] });
    try {
      const manifest = await readManifest(handle.manifestPath);
      const docs = manifest.courses[0].folders[0].documents;
      const paths = docs.map((d) => d.path);
      expect(new Set(paths).size).toBe(2);
      expect(paths.every((p) => p && p.length > 0)).toBe(true);

      for (const doc of docs) {
        const bytes = await fs.readFile(`${handle.dir}/${doc.path}`, "utf-8");
        expect(bytes).toMatch(/^content [AB]$/);
      }
    } finally {
      await handle.cleanup();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("materializes inline files (e.g. a cropped image) into an attachments manifest entry", async () => {
    const handle = await materializeCliWorkspace({
      inlineFiles: [{ filename: "crop", base64: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" }],
    });
    try {
      const manifest = await readManifest(handle.manifestPath);
      expect(manifest.attachments).toHaveLength(1);
      expect(manifest.attachments[0].mimeType).toBe("image/png");
      const bytes = await fs.readFile(`${handle.dir}/${manifest.attachments[0].path}`, "utf-8");
      expect(bytes).toBe("png bytes");
    } finally {
      await handle.cleanup();
    }
  });
});
