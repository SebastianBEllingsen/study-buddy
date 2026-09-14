import { buildCourseContext, chunkCourseContext, combineDocumentText } from "./context";
import { generateStructured, generateText, getModelInfo } from "./aiClient";
import {
  createGeneratedItem,
  getMasterFolder,
  getCourse,
  getNewDocumentsForItem,
  updateGeneratedItemContent,
} from "./models";
import type { GenerationMode, GeneratedItem } from "./models";
import { estimateTokens, CHUNK_THRESHOLD_TOKENS, chunkText } from "./chunking";
import type { QuizContent, FlashcardsContent, NotesContent, QuizQuestion, QuizGenerationSettings } from "./types";
import {
  quizSystemPrompt,
  quizUserPrompt,
  retryQuizSystemPrompt,
  retryQuizUserPrompt,
} from "./prompts/quiz";
import {
  flashcardsSystemPrompt,
  flashcardsUserPrompt,
} from "./prompts/flashcards";
import { notesSystemPrompt, notesUserPrompt, notesMergeSystemPrompt } from "./prompts/notes";
import {
  sanitizeNotesContent,
  sanitizeQuizContent,
  sanitizeFlashcardsContent,
} from "./mathSanitizer";

export class NoDocumentsError extends Error {
  constructor() {
    super(
      "This course has no successfully extracted documents yet — upload at least one PDF first."
    );
    this.name = "NoDocumentsError";
  }
}

async function generateQuiz(
  courseName: string,
  text: string,
  alreadyCovered?: string,
  settings?: QuizGenerationSettings
): Promise<QuizContent> {
  const content = await generateStructured<QuizContent>({
    system: quizSystemPrompt(courseName, settings),
    user: quizUserPrompt(text, alreadyCovered),
    maxTokens: 8000,
  });
  return sanitizeQuizContent(content);
}

async function generateQuizChunked(
  courseName: string,
  chunks: string[],
  alreadyCovered?: string,
  settings?: QuizGenerationSettings
): Promise<QuizContent> {
  const perChunk = await Promise.all(
    chunks.map((chunk) => generateQuiz(courseName, chunk, alreadyCovered, settings))
  );
  return { questions: perChunk.flatMap((c) => c.questions) };
}

async function generateFlashcards(
  courseName: string,
  text: string,
  alreadyCovered?: string
): Promise<FlashcardsContent> {
  const content = await generateStructured<FlashcardsContent>({
    system: flashcardsSystemPrompt(courseName),
    user: flashcardsUserPrompt(text, alreadyCovered),
    maxTokens: 8000,
  });
  return sanitizeFlashcardsContent(content);
}

async function generateFlashcardsChunked(
  courseName: string,
  chunks: string[],
  alreadyCovered?: string
): Promise<FlashcardsContent> {
  const perChunk = await Promise.all(
    chunks.map((chunk) => generateFlashcards(courseName, chunk, alreadyCovered))
  );
  return { cards: perChunk.flatMap((c) => c.cards) };
}

async function generateNotes(
  courseName: string,
  text: string,
  alreadyCovered?: string
): Promise<NotesContent> {
  const markdown = await generateText({
    system: notesSystemPrompt(courseName),
    user: notesUserPrompt(text, alreadyCovered),
    maxTokens: 8000,
  });
  return sanitizeNotesContent({ markdown });
}

async function generateNotesChunked(
  courseName: string,
  chunks: string[]
): Promise<NotesContent> {
  // Map: summarize each chunk independently.
  const chunkSummaries = await Promise.all(
    chunks.map((chunk) => generateNotes(courseName, chunk))
  );
  // Reduce: merge the chunk-level notes into one coherent document.
  const merged = await generateText({
    system: notesMergeSystemPrompt(courseName),
    user: chunkSummaries
      .map((s, i) => `--- Section ${i + 1} notes ---\n${s.markdown}`)
      .join("\n\n"),
    maxTokens: 8000,
  });
  return sanitizeNotesContent({ markdown: merged });
}

const MODE_LABELS: Record<GenerationMode, string> = {
  notes: "Notes",
  quiz: "Quiz",
  flashcards: "Flashcards",
};

export async function generateForCourse(
  courseId: number,
  mode: GenerationMode,
  options?: { folderId?: number | null; documentIds?: number[] | null; quizSettings?: QuizGenerationSettings }
) {
  const context = await buildCourseContext(courseId, options);
  if (context.documentIds.length === 0) {
    throw new NoDocumentsError();
  }

  const chunks = context.needsChunking ? chunkCourseContext(context) : null;

  let content: QuizContent | FlashcardsContent | NotesContent;

  switch (mode) {
    case "quiz":
      content = chunks
        ? await generateQuizChunked(context.courseName, chunks, undefined, options?.quizSettings)
        : await generateQuiz(context.courseName, context.combinedText, undefined, options?.quizSettings);
      break;
    case "flashcards":
      content = chunks
        ? await generateFlashcardsChunked(context.courseName, chunks)
        : await generateFlashcards(context.courseName, context.combinedText);
      break;
    case "notes":
      content = chunks
        ? await generateNotesChunked(context.courseName, chunks)
        : await generateNotes(context.courseName, context.combinedText);
      break;
  }

  const title = `${MODE_LABELS[mode]} — ${context.courseName} (${context.scopeLabel})`;

  // Scoped to a specific folder -> the result is filed right there,
  // alongside the documents it was generated from. Pooled ("All course
  // material", context.folderId null) -> the course's default folder.
  const storageFolderId = context.folderId ?? (await getMasterFolder(courseId)).id;

  return createGeneratedItem({
    courseId,
    folderId: storageFolderId,
    sourceFolderId: context.folderId,
    mode,
    title,
    contentJson: content,
    sourceDocumentIds: context.documentIds,
    model: await getModelInfo(),
  });
}

export class NoNewDocumentsError extends Error {
  constructor() {
    super("No newly-uploaded documents to add — this is already up to date.");
    this.name = "NoNewDocumentsError";
  }
}

// A short list of what the item already covers (question stems / card
// fronts / note headings, not the full content) — passed to the model as
// "avoid duplicating this" context when generating from just the new docs.
function summarizeExisting(item: GeneratedItem): string {
  const content = JSON.parse(item.content_json);
  switch (item.mode) {
    case "quiz":
      return (content as QuizContent).questions.map((q) => `- ${q.question}`).join("\n");
    case "flashcards":
      return (content as FlashcardsContent).cards.map((c) => `- ${c.front}`).join("\n");
    case "notes":
      return (content as NotesContent).markdown
        .split("\n")
        .filter((line) => /^#{1,6}\s/.test(line))
        .join("\n");
  }
}

// Appends delta entries to the END of existing arrays only — never
// reorders/inserts — because quiz_attempts and flashcard_reviews reference
// questions/cards by array index, and appending is what keeps those
// existing rows valid after a supplement.
function mergeGeneratedContent(
  mode: GenerationMode,
  existing: QuizContent | FlashcardsContent | NotesContent,
  delta: QuizContent | FlashcardsContent | NotesContent
): QuizContent | FlashcardsContent | NotesContent {
  switch (mode) {
    case "quiz":
      return {
        questions: [
          ...(existing as QuizContent).questions,
          ...(delta as QuizContent).questions,
        ],
      };
    case "flashcards":
      return {
        cards: [...(existing as FlashcardsContent).cards, ...(delta as FlashcardsContent).cards],
      };
    case "notes":
      return {
        markdown: `${(existing as NotesContent).markdown}\n\n---\n\n${(delta as NotesContent).markdown}`,
      };
  }
}

// Generates from ONLY the newly-uploaded documents in this item's folder
// (not the whole folder again) and merges the result into the existing item
// in place — same item id, so quiz attempts / flashcard reviews stay valid.
// Reuses the exact same generate*/generate*Chunked functions as a normal
// generation, just fed a smaller document set plus an "already covered"
// hint to reduce duplicate questions/cards on overlapping material.
export async function supplementGeneratedItem(item: GeneratedItem): Promise<GeneratedItem> {
  const newDocs = await getNewDocumentsForItem(item);
  if (newDocs.length === 0) {
    throw new NoNewDocumentsError();
  }

  const course = await getCourse(item.course_id);
  const courseName = course?.name ?? "this course";
  const combinedText = combineDocumentText(newDocs);
  const chunks =
    estimateTokens(combinedText) > CHUNK_THRESHOLD_TOKENS ? chunkText(combinedText) : null;
  const alreadyCovered = summarizeExisting(item);

  let delta: QuizContent | FlashcardsContent | NotesContent;
  switch (item.mode) {
    case "quiz":
      delta = chunks
        ? await generateQuizChunked(courseName, chunks, alreadyCovered)
        : await generateQuiz(courseName, combinedText, alreadyCovered);
      break;
    case "flashcards":
      delta = chunks
        ? await generateFlashcardsChunked(courseName, chunks, alreadyCovered)
        : await generateFlashcards(courseName, combinedText, alreadyCovered);
      break;
    case "notes":
      delta = chunks
        ? await generateNotesChunked(courseName, chunks)
        : await generateNotes(courseName, combinedText, alreadyCovered);
      break;
  }

  const existingContent = JSON.parse(item.content_json) as
    | QuizContent
    | FlashcardsContent
    | NotesContent;
  const merged = mergeGeneratedContent(item.mode, existingContent, delta);
  const existingSourceIds = JSON.parse(item.source_document_ids) as number[];

  return updateGeneratedItemContent({
    id: item.id,
    contentJson: merged,
    sourceDocumentIds: [...existingSourceIds, ...newDocs.map((d) => d.id)],
    model: await getModelInfo(),
  });
}

export class NoMissedQuestionsError extends Error {
  constructor() {
    super("No missed questions to retry.");
    this.name = "NoMissedQuestionsError";
  }
}

function correctAnswerText(q: QuizQuestion): string {
  if (q.type === "mcq") return q.options[q.correctIndex];
  if (q.type === "multi_select") return q.correctIndices.map((i) => q.options[i]).join(", ");
  return q.modelAnswer;
}

// A fresh, separate quiz item generated from just the questions missed on a
// previous attempt — new questions testing the same concepts, not verbatim
// repeats (see retryQuizSystemPrompt). Kept as its own generated_items row
// rather than merged into the original, so it gets its own attempt history
// and every existing item-page feature (hints, supplement, grading) works
// on it unmodified.
export async function createRetryQuiz(
  item: GeneratedItem,
  missedIndices: number[]
): Promise<GeneratedItem> {
  if (missedIndices.length === 0) {
    throw new NoMissedQuestionsError();
  }

  const content = JSON.parse(item.content_json) as QuizContent;
  const missed = missedIndices
    .map((i) => content.questions[i])
    .filter((q): q is QuizQuestion => q != null)
    .map((q) => ({
      question: q.question,
      correctAnswer: correctAnswerText(q),
      explanation: q.explanation,
    }));

  const course = await getCourse(item.course_id);
  const courseName = course?.name ?? "this course";

  const rawRetryContent = await generateStructured<QuizContent>({
    system: retryQuizSystemPrompt(courseName),
    user: retryQuizUserPrompt(missed),
    maxTokens: 8000,
  });
  const retryContent = sanitizeQuizContent(rawRetryContent);

  return createGeneratedItem({
    courseId: item.course_id,
    folderId: item.folder_id,
    sourceFolderId: item.source_folder_id,
    mode: "quiz",
    title: `Retry: ${item.title}`,
    contentJson: retryContent,
    sourceDocumentIds: [],
    model: await getModelInfo(),
  });
}
