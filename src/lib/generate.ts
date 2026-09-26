import { buildCourseContext, chunkCourseContext, combineDocumentText, type CourseContext } from "./context";
import { generateStructured, generateText, getModelInfo } from "./aiClient";
import {
  createGeneratedItem,
  getCourse,
  getFolder,
  getNewDocumentsForItem,
  updateGeneratedItemContent,
  getAppSettings,
} from "./models";
import type { GenerationMode, GeneratedItem } from "./models";
import { estimateTokens, CHUNK_THRESHOLD_TOKENS, chunkText } from "./chunking";
import { mapWithConcurrency } from "./concurrency";
import type {
  QuizContent,
  FlashcardsContent,
  NotesContent,
  QuizQuestion,
  QuizGenerationSettings,
  SourceRef,
} from "./types";
import { attachSources } from "./sources/itemMeta";
import { factCheckContent } from "./sources/factCheck";
import {
  quizSystemPrompt,
  quizUserPrompt,
  retryQuizSystemPrompt,
  retryQuizUserPrompt,
  distributeCount,
  TOTAL_QUESTIONS,
} from "./prompts/quiz";
import {
  flashcardsSystemPrompt,
  flashcardsUserPrompt,
  TOTAL_CARDS,
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

// Normal maxTokens for all generation calls; efficiency mode (see
// AppSettings.aiEfficiencyMode) halves it and drops effort/model, per the
// call sites below that read it.
const MAX_TOKENS = 8000;
const EFFICIENT_MAX_TOKENS = 4000;

// How many chunks' generation calls run at once — see mapWithConcurrency's
// own comment for why this can't be a plain Promise.all. Low enough to stay
// well clear of typical provider rate limits and to keep concurrent CLI
// subprocess spawns (claudeCode.ts/codexCli.ts, each with its own 5-minute
// timeout) to a sane number, high enough that chunking still finishes in
// roughly (chunk count / this) round trips rather than one at a time.
const CHUNK_CONCURRENCY = 3;

// Swaps the source name each generated card/question gives for a reference
// to that section (see attachSources). Skipped when the model's output isn't
// an array there — the sanitizer's shape check reports that.
function withSources<C extends object>(content: C, key: "questions" | "cards", sources: SourceRef[]): C {
  const items = (content as Record<string, unknown>)?.[key];
  if (!Array.isArray(items)) return content;
  return { ...content, [key]: attachSources(items as { source?: unknown }[], sources) };
}

async function generateQuiz(
  courseName: string,
  text: string,
  alreadyCovered?: string,
  settings?: QuizGenerationSettings,
  efficient?: boolean,
  totalQuestions?: number,
  documentIds?: number[],
  sources: SourceRef[] = []
): Promise<QuizContent> {
  const content = await generateStructured<QuizContent>({
    system: quizSystemPrompt(courseName, settings, totalQuestions),
    user: quizUserPrompt(text, alreadyCovered),
    maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
    effort: efficient ? "low" : "medium",
    efficient,
    workspaceScope: documentIds?.length ? { documentIds } : undefined,
  });
  return sanitizeQuizContent(withSources(content, "questions", sources));
}

// Distributes the same TOTAL_QUESTIONS a single-call generation would ask
// for across all chunks, rather than asking every chunk for a full
// TOTAL_QUESTIONS each — without this, a course large enough to need N
// chunks came back with N*TOTAL_QUESTIONS questions (a few hundred on a
// large course, from as many billed model calls). Chunks distributeCount
// assigns zero to (once there are more chunks than TOTAL_QUESTIONS) are
// skipped rather than queried for "0 questions".
async function generateQuizChunked(
  courseName: string,
  chunks: string[],
  alreadyCovered?: string,
  settings?: QuizGenerationSettings,
  efficient?: boolean,
  documentIds?: number[],
  sources: SourceRef[] = []
): Promise<QuizContent> {
  const counts = distributeCount(TOTAL_QUESTIONS, chunks.length);
  const targeted = chunks.map((chunk, i) => ({ chunk, count: counts[i] })).filter((t) => t.count > 0);
  const perChunk = await mapWithConcurrency(targeted, CHUNK_CONCURRENCY, ({ chunk, count }) =>
    generateQuiz(courseName, chunk, alreadyCovered, settings, efficient, count, documentIds, sources)
  );
  return { questions: perChunk.flatMap((c) => c.questions) };
}

async function generateFlashcards(
  courseName: string,
  text: string,
  alreadyCovered?: string,
  efficient?: boolean,
  totalCards?: number,
  documentIds?: number[],
  sources: SourceRef[] = []
): Promise<FlashcardsContent> {
  const content = await generateStructured<FlashcardsContent>({
    system: flashcardsSystemPrompt(courseName, totalCards),
    user: flashcardsUserPrompt(text, alreadyCovered),
    maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
    effort: efficient ? "low" : "medium",
    efficient,
    workspaceScope: documentIds?.length ? { documentIds } : undefined,
  });
  return sanitizeFlashcardsContent(withSources(content, "cards", sources));
}

// Same reasoning as generateQuizChunked: distributes TOTAL_CARDS across
// chunks instead of asking every chunk for a full TOTAL_CARDS each.
async function generateFlashcardsChunked(
  courseName: string,
  chunks: string[],
  alreadyCovered?: string,
  efficient?: boolean,
  documentIds?: number[],
  sources: SourceRef[] = []
): Promise<FlashcardsContent> {
  const counts = distributeCount(TOTAL_CARDS, chunks.length);
  const targeted = chunks.map((chunk, i) => ({ chunk, count: counts[i] })).filter((t) => t.count > 0);
  const perChunk = await mapWithConcurrency(targeted, CHUNK_CONCURRENCY, ({ chunk, count }) =>
    generateFlashcards(courseName, chunk, alreadyCovered, efficient, count, documentIds, sources)
  );
  return { cards: perChunk.flatMap((c) => c.cards) };
}

async function generateNotes(
  courseName: string,
  text: string,
  alreadyCovered?: string,
  efficient?: boolean,
  documentIds?: number[]
): Promise<NotesContent> {
  const markdown = await generateText({
    system: notesSystemPrompt(courseName),
    user: notesUserPrompt(text, alreadyCovered),
    maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
    effort: efficient ? "low" : "medium",
    efficient,
    workspaceScope: documentIds?.length ? { documentIds } : undefined,
  });
  return sanitizeNotesContent({ markdown });
}

async function generateNotesChunked(
  courseName: string,
  chunks: string[],
  efficient?: boolean,
  documentIds?: number[]
): Promise<NotesContent> {
  // Map: summarize each chunk independently.
  const chunkSummaries = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, (chunk) =>
    generateNotes(courseName, chunk, undefined, efficient, documentIds)
  );
  // Reduce: merge the chunk-level notes into one coherent document.
  const merged = await generateText({
    system: notesMergeSystemPrompt(courseName),
    user: chunkSummaries
      .map((s, i) => `--- Section ${i + 1} notes ---\n${s.markdown}`)
      .join("\n\n"),
    maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
    effort: efficient ? "low" : "medium",
    efficient,
    workspaceScope: documentIds?.length ? { documentIds } : undefined,
  });
  return sanitizeNotesContent({ markdown: merged });
}

const MODE_LABELS: Record<GenerationMode, string> = {
  notes: "Notes",
  quiz: "Quiz",
  flashcards: "Flashcards",
};

export class DestinationFolderNotFoundError extends Error {
  constructor() {
    super("That destination folder no longer exists.");
    this.name = "DestinationFolderNotFoundError";
  }
}

export async function generateForCourse(
  courseId: number,
  mode: GenerationMode,
  options?: {
    folderId?: number | null;
    documentIds?: number[] | null;
    // Vault notes (marked for generation) to include in a hand-picked set.
    noteIds?: number[] | null;
    quizSettings?: QuizGenerationSettings;
    // Where the generated item gets filed. `undefined` (the default): same
    // as before this existed — the source folder (options.folderId) when
    // scoped to one, otherwise the course's default folder. `null`: force
    // the default folder even when generating from a specific source folder
    // or a hand-picked document set. A number: file it there instead,
    // independent of the source scope — same "pick a folder, or create a
    // new one" choice as uploading a document (see resolveDestinationFolderId
    // in the course page).
    destinationFolderId?: number | null;
    // Generating for one study-plan chapter (see lib/studyPlan/): the item
    // is titled after the chapter and linked to it, so its results count
    // toward the chapter's mastery. The chapter's linked documents come in
    // as documentIds; a chapter with none is generated from its topic
    // outline instead of failing with NoDocumentsError.
    studyPlanChapter?: { id: number; title: string; summary: string; subtopics: string[] };
    // A topic typed by the learner, for a scope with no material (e.g. a
    // self-study course that hasn't got any documents yet): generated from
    // established knowledge of the topic instead of failing with
    // NoDocumentsError. Ignored when the scope has material.
    topic?: string | null;
  }
) {
  const { aiEfficiencyMode: efficient, preferredLanguage: language } = await getAppSettings();

  const chapter = options?.studyPlanChapter;
  let context =
    chapter && !options?.documentIds?.length
      ? await chapterTopicContext(courseId, chapter)
      : await buildCourseContext(courseId, options);
  // A chapter whose linked documents have since been deleted (or stopped
  // extracting) falls back to its topic outline too.
  if (chapter && context.documentIds.length === 0 && !context.combinedText) {
    context = await chapterTopicContext(courseId, chapter);
  }
  const topic = options?.topic?.trim() || null;
  const fromTopic = !chapter && context.documentIds.length === 0 && context.noteIds.length === 0 && !!topic;
  if (fromTopic) {
    context = await topicContext(courseId, topic!);
  } else if (context.documentIds.length === 0 && context.noteIds.length === 0 && !chapter) {
    throw new NoDocumentsError();
  }

  const chunks = context.needsChunking ? chunkCourseContext(context) : null;

  let content: QuizContent | FlashcardsContent | NotesContent;

  switch (mode) {
    case "quiz":
      content = chunks
        ? await generateQuizChunked(
            context.courseName,
            chunks,
            undefined,
            options?.quizSettings,
            efficient,
            context.documentIds,
            context.sources
          )
        : await generateQuiz(
            context.courseName,
            context.combinedText,
            undefined,
            options?.quizSettings,
            efficient,
            undefined,
            context.documentIds,
            context.sources
          );
      content = await factCheckContent("quiz", content, {
        courseName: context.courseName,
        material: context.combinedText,
        efficient,
        language,
      });
      break;
    case "flashcards":
      content = chunks
        ? await generateFlashcardsChunked(
            context.courseName,
            chunks,
            undefined,
            efficient,
            context.documentIds,
            context.sources
          )
        : await generateFlashcards(
            context.courseName,
            context.combinedText,
            undefined,
            efficient,
            undefined,
            context.documentIds,
            context.sources
          );
      content = await factCheckContent("flashcards", content, {
        courseName: context.courseName,
        material: context.combinedText,
        efficient,
        language,
      });
      break;
    case "notes":
      content = chunks
        ? await generateNotesChunked(context.courseName, chunks, efficient, context.documentIds)
        : await generateNotes(context.courseName, context.combinedText, undefined, efficient, context.documentIds);
      break;
  }

  const title = chapter
    ? `${MODE_LABELS[mode]} — ${chapter.title}`
    : fromTopic
      ? `${MODE_LABELS[mode]} — ${topic}`
    : `${MODE_LABELS[mode]} — ${context.courseName} (${context.scopeLabel})`;

  let storageFolderId: number | null;
  if (options?.destinationFolderId !== undefined) {
    if (options.destinationFolderId === null) {
      storageFolderId = null;
    } else {
      const destination = await getFolder(options.destinationFolderId);
      if (!destination || destination.course_id !== courseId) {
        throw new DestinationFolderNotFoundError();
      }
      storageFolderId = destination.id;
    }
  } else {
    // No explicit destination given: same as before this existed — scoped
    // to a specific folder -> filed right there, alongside the documents it
    // was generated from. Pooled ("All course material", context.folderId
    // null) -> the course page itself.
    storageFolderId = context.folderId;
  }

  return createGeneratedItem({
    courseId,
    folderId: storageFolderId,
    sourceFolderId: context.folderId,
    sourceHandpicked: context.handpicked,
    mode,
    title,
    contentJson: content,
    sourceDocumentIds: context.documentIds,
    model: await getModelInfo(efficient),
    studyPlanChapterId: chapter?.id ?? null,
  });
}

// Stand-in "material" for a study-plan chapter with no course documents:
// its own topic outline, plus an explicit note overriding the prompts'
// usual "use only the provided material" rule — there is no material, so
// the model has to teach the listed topics from established knowledge.
export function chapterTopicText(chapter: { title: string; summary: string; subtopics: string[] }): string {
  return [
    "There are no course documents for this part of the course — only the topic outline below. Write accurate content covering these topics from standard, well-established knowledge of the subject, rather than only from the text given.",
    "",
    `Chapter: ${chapter.title}`,
    chapter.summary ? `Summary: ${chapter.summary}` : "",
    chapter.subtopics.length ? `Topics:\n${chapter.subtopics.map((s) => `- ${s}`).join("\n")}` : "",
  ]
    .filter((line, i) => i < 2 || line)
    .join("\n");
}

// Stand-in "material" for a learner-typed topic — see the `topic` option on
// generateForCourse.
export function topicText(topic: string): string {
  return [
    "There is no material for this — only the topic below. Write accurate content covering its core ideas from standard, well-established knowledge of the subject, rather than only from the text given. Pitch it at someone learning the topic, and cover it broadly rather than one narrow corner.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

async function topicContext(courseId: number, topic: string): Promise<CourseContext> {
  const context = await chapterTopicContext(courseId, { title: topic, summary: "", subtopics: [] });
  const combinedText = topicText(topic);
  return { ...context, combinedText, estimatedTokens: estimateTokens(combinedText) };
}

async function chapterTopicContext(
  courseId: number,
  chapter: { title: string; summary: string; subtopics: string[] }
): Promise<CourseContext> {
  const course = await getCourse(courseId);
  if (!course) throw new Error(`Course ${courseId} not found`);
  const combinedText = chapterTopicText(chapter);
  return {
    courseId,
    courseName: course.name,
    folderId: null,
    handpicked: false,
    scopeLabel: chapter.title,
    documentIds: [],
    noteIds: [],
    sources: [],
    combinedText,
    estimatedTokens: estimateTokens(combinedText),
    needsChunking: false,
  };
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
      // Spread first so deck-level settings (e.g. `reminders`) survive.
      return {
        ...(existing as FlashcardsContent),
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
  const { aiEfficiencyMode: efficient, preferredLanguage: language } = await getAppSettings();

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
  const documentIds = newDocs.map((d) => d.id);
  const sources: SourceRef[] = newDocs.map((d) => ({ kind: "document", id: d.id, title: d.filename }));

  let delta: QuizContent | FlashcardsContent | NotesContent;
  switch (item.mode) {
    case "quiz":
      delta = chunks
        ? await generateQuizChunked(courseName, chunks, alreadyCovered, undefined, efficient, documentIds, sources)
        : await generateQuiz(
            courseName,
            combinedText,
            alreadyCovered,
            undefined,
            efficient,
            undefined,
            documentIds,
            sources
          );
      break;
    case "flashcards":
      delta = chunks
        ? await generateFlashcardsChunked(courseName, chunks, alreadyCovered, efficient, documentIds, sources)
        : await generateFlashcards(courseName, combinedText, alreadyCovered, efficient, undefined, documentIds, sources);
      break;
    case "notes":
      delta = chunks
        ? await generateNotesChunked(courseName, chunks, efficient, documentIds)
        : await generateNotes(courseName, combinedText, alreadyCovered, efficient, documentIds);
      break;
  }

  const existingContent = JSON.parse(item.content_json) as
    | QuizContent
    | FlashcardsContent
    | NotesContent;
  if (item.mode !== "notes") {
    delta = await factCheckContent(item.mode, delta as QuizContent | FlashcardsContent, {
      courseName,
      material: combinedText,
      efficient,
      language,
    });
  }
  const merged = mergeGeneratedContent(item.mode, existingContent, delta);
  const existingSourceIds = JSON.parse(item.source_document_ids) as number[];

  return updateGeneratedItemContent({
    id: item.id,
    contentJson: merged,
    sourceDocumentIds: [...existingSourceIds, ...newDocs.map((d) => d.id)],
    model: await getModelInfo(efficient),
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

  const { aiEfficiencyMode: efficient, preferredLanguage: language } = await getAppSettings();

  const course = await getCourse(item.course_id);
  const courseName = course?.name ?? "this course";

  const rawRetryContent = await generateStructured<QuizContent>({
    system: retryQuizSystemPrompt(courseName),
    user: retryQuizUserPrompt(missed),
    maxTokens: efficient ? EFFICIENT_MAX_TOKENS : MAX_TOKENS,
    effort: efficient ? "low" : "medium",
    efficient,
  });
  const retryContent = await factCheckContent("quiz", sanitizeQuizContent(rawRetryContent), {
    courseName,
    efficient,
    language,
  });

  return createGeneratedItem({
    courseId: item.course_id,
    folderId: item.folder_id,
    sourceFolderId: item.source_folder_id,
    sourceHandpicked: item.source_handpicked,
    mode: "quiz",
    title: `Retry: ${item.title}`,
    contentJson: retryContent,
    sourceDocumentIds: [],
    model: await getModelInfo(efficient),
  });
}
