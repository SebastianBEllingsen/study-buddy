import crypto from "node:crypto";
import { looksLikePastExam } from "../exams/detect";
import { buildMaterialDigest } from "./materialDigest";

// Past tests and quizzes get their own, much smaller slice of the outline,
// so a course with dozens of them can't crowd out the teaching material.
const MATERIAL_DIGEST_TOKENS = 24_000;
const ASSESSMENT_DIGEST_TOKENS = 5_000;

export interface PlanMaterialDocument {
  filename: string;
  extracted_text: string | null;
}

export interface PlanMaterialNote {
  title: string;
  markdown: string;
}

export interface PlanMaterialDigests {
  material: string;
  // Empty unless there are past tests/quizzes alongside other material.
  assessments: string;
}

// The outline sent to the model for building or updating a plan: documents
// and notes together, with filenames that look like past tests or exams
// split into a separate, capped section. They're only split off when there
// is other material to protect — a course of nothing but quizzes still
// needs them as its source.
export function buildPlanMaterialDigests(
  documents: PlanMaterialDocument[],
  notes: PlanMaterialNote[]
): PlanMaterialDigests {
  const assessments = documents.filter((d) => looksLikePastExam(d.filename));
  const teaching = documents.filter((d) => !looksLikePastExam(d.filename));
  const separate = assessments.length > 0 && teaching.length + notes.length > 0;

  const noteItems = notes.map((n) => ({ filename: n.title, extracted_text: n.markdown, kind: "note" as const }));
  return {
    material: buildMaterialDigest([...(separate ? teaching : documents), ...noteItems], MATERIAL_DIGEST_TOKENS),
    assessments: separate ? buildMaterialDigest(assessments, ASSESSMENT_DIGEST_TOKENS) : "",
  };
}

// What a plan remembers about a note it has seen, so a later edit to the
// note's text or title makes it count as new material again.
export function noteFingerprint(note: PlanMaterialNote): string {
  return crypto.createHash("sha1").update(`${note.title}\n${note.markdown}`).digest("hex").slice(0, 12);
}

// The material a chapter's generated quiz/flashcards/notes come from: its
// linked documents and notes, or null/null (the chapter's own topics, see
// generateForCourse) when it has none.
export function chapterGenerationScope(chapter: {
  linked_document_ids: number[];
  linked_note_ids: number[];
}): { documentIds: number[] | null; noteIds: number[] | null } {
  return {
    documentIds: chapter.linked_document_ids.length ? chapter.linked_document_ids : null,
    noteIds: chapter.linked_note_ids.length ? chapter.linked_note_ids : null,
  };
}
