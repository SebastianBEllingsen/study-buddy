import { describe, it, expect, vi, beforeEach } from "vitest";

const generateStructured = vi.fn();
vi.mock("./aiClient", () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
}));

const createFolder = vi.fn();
const getFolder = vi.fn();
vi.mock("./models", () => ({
  createFolder: (...args: unknown[]) => createFolder(...args),
  getFolder: (...args: unknown[]) => getFolder(...args),
}));

const ingestDocumentBytes = vi.fn();
vi.mock("./documentIngest", () => ({
  ingestDocumentBytes: (...args: unknown[]) => ingestDocumentBytes(...args),
}));

const { buildAvailableAttachmentsList, detectChatActions, executeChatActions } = await import("./chatActions");

function makeFolder(id: number, name: string) {
  return {
    id,
    course_id: 7,
    name,
    position: 0,
    parent_folder_id: null,
    icon: null,
    color: null,
    created_at: "",
  };
}

const FOLDERS = [makeFolder(3, "Week 1"), makeFolder(4, "Week 2")];

const ATTACHMENTS = [
  {
    ref: "m1-0",
    filename: "notes.pdf",
    type: "document" as const,
    data: { type: "document" as const, filename: "notes.pdf", mimeType: "application/pdf", fileBase64: "AAAA", extractedText: "hi" },
  },
];

beforeEach(() => {
  generateStructured.mockReset();
  createFolder.mockReset();
  getFolder.mockReset();
  ingestDocumentBytes.mockReset();
});

describe("buildAvailableAttachmentsList", () => {
  it("assigns a stable ref per message/attachment pair, across every message", () => {
    const messages = [
      { id: 1, attachments: [{ type: "image", filename: "a.png" }] },
      { id: 2, attachments: null },
      { id: 3, attachments: [{ type: "document", filename: "b.pdf" }, { type: "image", filename: "c.png" }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any[];

    const result = buildAvailableAttachmentsList(messages);

    expect(result.map((a) => a.ref)).toEqual(["m1-0", "m3-0", "m3-1"]);
    expect(result[1].filename).toBe("b.pdf");
  });
});

describe("detectChatActions", () => {
  async function detect(mockedResponse: unknown) {
    generateStructured.mockResolvedValue(mockedResponse);
    return detectChatActions({ transcript: "User: make a folder called X", availableAttachments: ATTACHMENTS, folders: FOLDERS });
  }

  it("returns no actions when the model detects none", async () => {
    const result = await detect({ actions: [], confirmationMessage: null });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("keeps a valid createFolder action with its confirmation message", async () => {
    const result = await detect({
      actions: [{ action: "createFolder", folderName: "Diagrams" }],
      confirmationMessage: 'Create "Diagrams"?',
    });
    expect(result).toEqual({
      actions: [{ action: "createFolder", folderName: "Diagrams" }],
      confirmationMessage: 'Create "Diagrams"?',
    });
  });

  it("drops a saveAttachment action referencing an unknown ref", async () => {
    const result = await detect({
      actions: [{ action: "saveAttachment", ref: "m99-0", folderId: 3, newFolderName: null }],
      confirmationMessage: "Save it?",
    });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("drops a saveAttachment action referencing a folder id not in this course", async () => {
    const result = await detect({
      actions: [{ action: "saveAttachment", ref: "m1-0", folderId: 999, newFolderName: null }],
      confirmationMessage: "Save it?",
    });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("keeps a valid saveAttachment action targeting an existing folder", async () => {
    const result = await detect({
      actions: [{ action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: null }],
      confirmationMessage: "Save it to Week 1?",
    });
    expect(result.actions).toEqual([{ action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: null }]);
  });

  it("prefers newFolderName over folderId when the model sets both", async () => {
    const result = await detect({
      actions: [{ action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: "Fresh" }],
      confirmationMessage: "Save it?",
    });
    expect(result.actions).toEqual([{ action: "saveAttachment", ref: "m1-0", folderId: null, newFolderName: "Fresh" }]);
  });

  it("drops a redundant standalone createFolder when a saveAttachment in the same batch already creates that folder", async () => {
    const result = await detect({
      actions: [
        { action: "createFolder", folderName: "Should Not Exist" },
        { action: "saveAttachment", ref: "m1-0", folderId: null, newFolderName: "Should Not Exist" },
      ],
      confirmationMessage: 'Create "Should Not Exist" and save notes.pdf there?',
    });
    expect(result.actions).toEqual([
      { action: "saveAttachment", ref: "m1-0", folderId: null, newFolderName: "Should Not Exist" },
    ]);
  });

  it("caps at 3 actions", async () => {
    const result = await detect({
      actions: Array.from({ length: 5 }, (_, i) => ({ action: "createFolder", folderName: `F${i}` })),
      confirmationMessage: "Create several folders?",
    });
    expect(result.actions).toHaveLength(3);
  });

  it("drops everything when there's no confirmationMessage to show", async () => {
    const result = await detect({
      actions: [{ action: "createFolder", folderName: "Diagrams" }],
      confirmationMessage: null,
    });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("swallows a generateStructured failure and returns no actions", async () => {
    generateStructured.mockRejectedValue(new Error("backend error"));
    const result = await detectChatActions({ transcript: "hi", availableAttachments: [], folders: [] });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });
});

describe("executeChatActions", () => {
  it("creates a folder", async () => {
    createFolder.mockResolvedValue({ id: 10, name: "Diagrams" });

    const summary = await executeChatActions(7, [{ action: "createFolder", folderName: "Diagrams" }], []);

    expect(createFolder).toHaveBeenCalledWith(7, "Diagrams");
    expect(summary).toContain('Created folder "Diagrams"');
  });

  it("saves an attachment into an existing folder", async () => {
    getFolder.mockResolvedValue({ id: 3, course_id: 7, name: "Week 1" });
    ingestDocumentBytes.mockResolvedValue({ id: 1 });

    const summary = await executeChatActions(
      7,
      [{ action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: null }],
      ATTACHMENTS
    );

    expect(ingestDocumentBytes).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 7, folderId: 3, filename: "notes.pdf" })
    );
    expect(summary).toContain('Saved "notes.pdf" to "Week 1"');
  });

  it("creates a new folder first when newFolderName is given", async () => {
    createFolder.mockResolvedValue({ id: 11, name: "Fresh" });
    ingestDocumentBytes.mockResolvedValue({ id: 1 });

    const summary = await executeChatActions(
      7,
      [{ action: "saveAttachment", ref: "m1-0", folderId: null, newFolderName: "Fresh" }],
      ATTACHMENTS
    );

    expect(createFolder).toHaveBeenCalledWith(7, "Fresh");
    expect(summary).toContain('Saved "notes.pdf" to "Fresh"');
  });

  it("refuses to save into a folder belonging to a different course", async () => {
    getFolder.mockResolvedValue({ id: 3, course_id: 999, name: "Someone else's folder" });

    const summary = await executeChatActions(
      7,
      [{ action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: null }],
      ATTACHMENTS
    );

    expect(ingestDocumentBytes).not.toHaveBeenCalled();
    expect(summary).toContain("no longer exists");
  });

  it("reports an attachment that's no longer available instead of throwing", async () => {
    const summary = await executeChatActions(
      7,
      [{ action: "saveAttachment", ref: "m404-0", folderId: 3, newFolderName: null }],
      ATTACHMENTS
    );

    expect(ingestDocumentBytes).not.toHaveBeenCalled();
    expect(summary).toContain("no longer available");
  });

  it("joins multiple action results into one summary", async () => {
    createFolder.mockResolvedValue({ id: 10, name: "A" });
    getFolder.mockResolvedValue({ id: 3, course_id: 7, name: "Week 1" });
    ingestDocumentBytes.mockResolvedValue({ id: 1 });

    const summary = await executeChatActions(
      7,
      [
        { action: "createFolder", folderName: "A" },
        { action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: null },
      ],
      ATTACHMENTS
    );

    expect(summary).toContain('Created folder "A"');
    expect(summary).toContain('Saved "notes.pdf" to "Week 1"');
  });
});
