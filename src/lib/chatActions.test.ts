import { describe, it, expect, vi, beforeEach } from "vitest";

const generateStructured = vi.fn();
vi.mock("./aiClient", () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
}));

const createCourse = vi.fn();
const createFolder = vi.fn();
const createNote = vi.fn();
const getCourse = vi.fn();
const getFolder = vi.fn();
vi.mock("./models", () => ({
  createCourse: (...args: unknown[]) => createCourse(...args),
  createFolder: (...args: unknown[]) => createFolder(...args),
  createNote: (...args: unknown[]) => createNote(...args),
  getCourse: (...args: unknown[]) => getCourse(...args),
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
  createCourse.mockReset();
  createFolder.mockReset();
  createNote.mockReset();
  getCourse.mockReset().mockResolvedValue({ id: 7, name: "Sample Course" });
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
  const COURSES = [
    { id: 7, name: "Sample Course" },
    { id: 8, name: "Other Course" },
  ];

  async function detect(
    mockedResponse: unknown,
    overrides: Partial<Parameters<typeof detectChatActions>[0]> = {}
  ) {
    generateStructured.mockResolvedValue(mockedResponse);
    return detectChatActions({
      transcript: "User: make a folder called X",
      availableAttachments: ATTACHMENTS,
      courses: COURSES,
      scopedCourseId: 7,
      accessibleCourseIds: [7],
      folders: FOLDERS,
      ...overrides,
    });
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
      actions: [{ action: "createFolder", folderName: "Diagrams", courseId: null }],
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
    expect(result.actions).toEqual([
      { action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: null, courseId: null },
    ]);
  });

  it("prefers newFolderName over folderId when the model sets both", async () => {
    const result = await detect({
      actions: [{ action: "saveAttachment", ref: "m1-0", folderId: 3, newFolderName: "Fresh" }],
      confirmationMessage: "Save it?",
    });
    expect(result.actions).toEqual([
      { action: "saveAttachment", ref: "m1-0", folderId: null, newFolderName: "Fresh", courseId: null },
    ]);
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
      { action: "saveAttachment", ref: "m1-0", folderId: null, newFolderName: "Should Not Exist", courseId: null },
    ]);
  });

  it("caps the number of actions", async () => {
    const result = await detect({
      actions: Array.from({ length: 20 }, (_, i) => ({ action: "createFolder", folderName: `F${i}` })),
      confirmationMessage: "Create several folders?",
    });
    expect(result.actions).toHaveLength(12);
  });

  it("keeps a createCourse action", async () => {
    const result = await detect(
      { actions: [{ action: "createCourse", courseName: "Intro to Topic" }], confirmationMessage: "Create it?" },
      { scopedCourseId: null, accessibleCourseIds: [], folders: [] }
    );
    expect(result.actions).toEqual([{ action: "createCourse", courseName: "Intro to Topic" }]);
  });

  it("lets folders and notes follow a createCourse when the conversation has no course", async () => {
    const result = await detect(
      {
        actions: [
          { action: "createCourse", courseName: "Intro to Topic" },
          { action: "createFolder", folderName: "Week 1" },
          { action: "createNote", title: "Key ideas", markdown: "# Key ideas", folderId: null, newFolderName: "Week 1" },
        ],
        confirmationMessage: "Create it all?",
      },
      { scopedCourseId: null, accessibleCourseIds: [], folders: [] }
    );
    expect(result.actions.map((a) => a.action)).toEqual(["createCourse", "createNote"]);
  });

  it("drops a folder/note with no course to put it in", async () => {
    const result = await detect(
      {
        actions: [
          { action: "createFolder", folderName: "Week 1" },
          { action: "createNote", title: "T", markdown: "x", folderId: null, newFolderName: null },
        ],
        confirmationMessage: "Create?",
      },
      { scopedCourseId: null, accessibleCourseIds: [], folders: [] }
    );
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("drops an action naming a course that doesn't exist", async () => {
    const result = await detect({
      actions: [{ action: "createFolder", folderName: "X", courseId: 999 }],
      confirmationMessage: "Create?",
    });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("keeps an explicit existing courseId on a note, even with no conversation course", async () => {
    const result = await detect(
      {
        actions: [{ action: "createNote", title: "T", markdown: "body", folderId: null, newFolderName: null, courseId: 8 }],
        confirmationMessage: "Add a note to Other Course?",
      },
      { scopedCourseId: null, accessibleCourseIds: [], folders: [] }
    );
    expect(result.actions).toEqual([
      { action: "createNote", title: "T", markdown: "body", folderId: null, newFolderName: null, courseId: 8 },
    ]);
  });

  it("drops a note with an unknown folder id's destination but keeps it on the course page", async () => {
    const result = await detect({
      actions: [{ action: "createNote", title: "T", markdown: "body", folderId: 999, newFolderName: null }],
      confirmationMessage: "Add a note?",
    });
    expect(result.actions).toEqual([
      { action: "createNote", title: "T", markdown: "body", folderId: null, newFolderName: null, courseId: null },
    ]);
  });

  it("drops a note without a title or body", async () => {
    const result = await detect({
      actions: [
        { action: "createNote", title: "  ", markdown: "body", folderId: null, newFolderName: null },
        { action: "createNote", title: "T", markdown: 5, folderId: null, newFolderName: null },
      ],
      confirmationMessage: "Add notes?",
    });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("keeps a readCourse for a course whose content isn't visible", async () => {
    const result = await detect({
      actions: [{ action: "readCourse", courseId: 8 }],
      confirmationMessage: "May I read Other Course?",
    });
    expect(result.actions).toEqual([{ action: "readCourse", courseId: 8 }]);
  });

  it("drops a readCourse for a course that's already visible or doesn't exist", async () => {
    const result = await detect({
      actions: [
        { action: "readCourse", courseId: 7 },
        { action: "readCourse", courseId: 999 },
      ],
      confirmationMessage: "May I read it?",
    });
    expect(result).toEqual({ actions: [], confirmationMessage: null });
  });

  it("only shows the model course names for courses it can't see, not their folders", async () => {
    await detect({ actions: [], confirmationMessage: null }, { folders: FOLDERS });
    const system: string = generateStructured.mock.calls[0][0].system;
    expect(system).toContain('"Other Course" (content NOT visible)');
    expect(system).toContain('"Sample Course" (this conversation\'s course, content already visible)');
    expect(system).toContain('"Week 1"');
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
    const result = await detectChatActions({
      transcript: "hi",
      availableAttachments: [],
      courses: [],
      scopedCourseId: null,
      accessibleCourseIds: [],
      folders: [],
    });
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

  it("creates a course, then puts later folders and notes in it", async () => {
    createCourse.mockResolvedValue({ id: 20, name: "Intro to Topic" });
    getCourse.mockResolvedValue({ id: 20, name: "Intro to Topic" });
    createFolder.mockResolvedValue({ id: 30, name: "Week 1" });
    createNote.mockResolvedValue({ id: 40, title: "Key ideas" });

    const summary = await executeChatActions(
      null,
      [
        { action: "createCourse", courseName: "Intro to Topic" },
        { action: "createFolder", folderName: "Week 1" },
        { action: "createNote", title: "Key ideas", markdown: "# Key", folderId: null, newFolderName: "Week 1" },
      ],
      []
    );

    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledWith(20, "Week 1");
    expect(createNote).toHaveBeenCalledWith("Key ideas", 20, 30, "# Key");
    expect(summary).toContain('Created course "Intro to Topic"');
    expect(summary).toContain('Created note "Key ideas" in "Week 1"');
  });

  it("reports there's no course to use when a conversation has none and none was created", async () => {
    const summary = await executeChatActions(null, [{ action: "createFolder", folderName: "X" }], []);
    expect(createFolder).not.toHaveBeenCalled();
    expect(summary).toContain("no course");
  });

  it("creates a note directly on the course page when no folder is given", async () => {
    createNote.mockResolvedValue({ id: 40, title: "Overview" });
    const summary = await executeChatActions(
      7,
      [{ action: "createNote", title: "Overview", markdown: "body", folderId: null, newFolderName: null }],
      []
    );
    expect(createNote).toHaveBeenCalledWith("Overview", 7, null, "body");
    expect(summary).toBe('Created note "Overview".');
  });

  it("honors an explicit courseId over the conversation's course", async () => {
    getCourse.mockResolvedValue({ id: 8, name: "Other Course" });
    createFolder.mockResolvedValue({ id: 31, name: "X" });
    await executeChatActions(7, [{ action: "createFolder", folderName: "X", courseId: 8 }], []);
    expect(createFolder).toHaveBeenCalledWith(8, "X");
  });

  it("reports a failed note creation (e.g. duplicate title) without throwing", async () => {
    createNote.mockRejectedValue(new Error('A note titled "Overview" already exists'));
    const summary = await executeChatActions(
      7,
      [{ action: "createNote", title: "Overview", markdown: "b", folderId: null, newFolderName: null }],
      []
    );
    expect(summary).toContain("already exists");
  });

  it("acknowledges a readCourse grant without writing anything", async () => {
    getCourse.mockResolvedValue({ id: 8, name: "Other Course" });
    const summary = await executeChatActions(null, [{ action: "readCourse", courseId: 8 }], []);
    expect(summary).toBe('Allowed to read "Other Course" in this conversation.');
    expect(createFolder).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("reports a readCourse for a course that no longer exists", async () => {
    getCourse.mockResolvedValue(undefined);
    const summary = await executeChatActions(null, [{ action: "readCourse", courseId: 8 }], []);
    expect(summary).toContain("no longer exists");
  });
});
