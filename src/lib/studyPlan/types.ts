// Shared shapes for the Study plan feature. Client-safe (types plus a few
// constant lists) — no DB imports — so components can use them directly.

import type { AiBackend } from "../models";

export type StudyPlanStatus = "draft_topics" | "generating" | "ready" | "failed";
export type StudyPlanPreset = "roadmap" | "guided";
export type ChapterLevel = "new" | "familiar" | "known";
export type ResourceOrigin = "ai" | "user";
export type SessionKind = "study" | "review";

export const RESOURCE_KINDS = ["video", "playlist", "course", "article", "interactive", "book"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

// unchecked: not verified yet. ok: reachable learning content. unknown: the
// site wouldn't say (bot wall, rate limit, timeout) — kept, with a badge.
// dead: gone. blocked: reachable but not allowed (a store page, a book that
// isn't free to read, an unsafe address).
export const LINK_STATUSES = ["unchecked", "ok", "unknown", "dead", "blocked"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export type ResourceDensity = "fewer" | "normal" | "more";

export interface Subtopic {
  text: string;
  done: boolean;
}

export interface StudyPlanOptions {
  preset: StudyPlanPreset;
  // Find web resources per chapter.
  webResources: boolean;
  density: ResourceDensity;
  // Ask the user what they already know before finding resources.
  topicLevels: boolean;
  // Quiz / flashcards / notes buttons per chapter, and mastery from them.
  practice: boolean;
  // Spread chapters over dated study sessions.
  schedule: boolean;
  // YYYY-MM-DD, or null for no deadline (sessions just run on in order).
  deadline: string | null;
  // Weekdays to study on, 0 = Sunday … 6 = Saturday.
  studyDays: number[];
  minutesPerDay: number;
  // Sessions are also added to the user's Google Calendar (only offered
  // when it's connected). Not a setup choice — toggled from the plan page.
  googleCalendar: boolean;
}

export interface StudyPlanSession {
  id: number;
  plan_id: number;
  chapter_id: number;
  // YYYY-MM-DD
  date: string;
  minutes: number;
  kind: SessionKind;
  done_at: string | null;
  google_event_id: string | null;
}

export interface StudyPlanResource {
  id: number;
  chapter_id: number;
  position: number;
  kind: ResourceKind;
  title: string;
  url: string;
  provider: string | null;
  language: string | null;
  note: string;
  origin: ResourceOrigin;
  link_status: LinkStatus;
  status_detail: string | null;
  checked_at: string | null;
  done_at: string | null;
  created_at: string;
}

export interface StudyPlanChapter {
  id: number;
  plan_id: number;
  position: number;
  stage: number;
  title: string;
  summary: string;
  subtopics: Subtopic[];
  prerequisite_ids: number[];
  linked_document_ids: number[];
  current_level: ChapterLevel | null;
  estimated_minutes: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  resources: StudyPlanResource[];
  // Quizzes/flashcards/notes generated for this chapter.
  items: ChapterItem[];
  // 0–1 from those items' results (see mastery.ts); null with none yet.
  mastery: number | null;
}

export interface ChapterItem {
  id: number;
  mode: "notes" | "quiz" | "flashcards";
  title: string;
  created_at: string;
  // Best finished-quiz score, 0–100.
  best_score: number | null;
}

export interface StudyPlanSummary {
  id: number;
  course_id: number;
  title: string;
  status: StudyPlanStatus;
  preset: StudyPlanPreset;
  options: StudyPlanOptions;
  syllabus_document_id: number | null;
  syllabus_text: string | null;
  source_document_ids: number[];
  source_folder_id: number | null;
  source_handpicked: boolean;
  language: string;
  model_provider: AiBackend | null;
  model_name: string | null;
  used_web_search: boolean;
  error_message: string | null;
  links_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyPlan extends StudyPlanSummary {
  chapters: StudyPlanChapter[];
  sessions: StudyPlanSession[];
}

// What the outline call returns — see prompts/studyPlan.ts.
export interface PlanOutlineChapter {
  title: string;
  summary: string;
  subtopics: string[];
  // 1-based numbers of earlier chapters in this same list.
  prerequisites: number[];
  stage: number;
  estimatedMinutes: number | null;
  // Filenames from the material list the model was shown — mapped back to
  // document ids server-side, never trusted as ids.
  matchedDocuments: string[];
}

export interface PlanOutline {
  title: string;
  chapters: PlanOutlineChapter[];
}

// What a resource-search call returns per suggestion.
export interface ResourceSuggestion {
  kind: ResourceKind;
  title: string;
  url: string;
  provider?: string;
  language?: string;
  note: string;
}
