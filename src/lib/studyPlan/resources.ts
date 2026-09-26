import { backendSupportsWebSearch, generateWithWebSearch } from "../aiClient";
import { parseJsonFromText } from "../aiBackends/jsonText";
import { normalizeResourceSuggestions } from "../aiResponseValidation";
import { verifyLinks, linkCheckKey, type LinkCheckResult } from "../linkVerifier";
import { resourceSearchSystemPrompt, resourceSearchUserPrompt, type ResourceSearchChapter } from "../prompts/studyPlan";
import { getAppSettings, getCourse } from "../models";
import { languageName } from "../languages";
import { nowUtc } from "../time";
import { resourceTarget } from "./options";
import {
  getChapter,
  getStudyPlan,
  replaceAiResources,
  setPlanLinksCheckedAt,
  setResourceLinkCheck,
  type NewResource,
} from "./store";
import type { ChapterLevel, ResourceDensity, ResourceSuggestion } from "./types";

// A chapter the student already knows gets a single refresher link.
export function targetFor(density: ResourceDensity, level: ChapterLevel | null | undefined) {
  return level === "known" ? { min: 1, max: 1 } : resourceTarget(density);
}

// Finding and checking a chapter's web resources — used both while building
// a whole plan (generatePlan.ts) and for "find different resources" on one
// chapter afterward.

// Kept: reachable learning content, or a site that wouldn't say either way
// (bot walls are common on legitimate course sites). Dropped: dead, blocked.
function isKeepable(check: LinkCheckResult): boolean {
  return check.status === "ok" || check.status === "unknown";
}

async function suggestResources(
  courseName: string,
  chapter: ResourceSearchChapter,
  options: { languageName: string; density: ResourceDensity; efficient: boolean; excludedUrls: string[] }
): Promise<{ suggestions: ResourceSuggestion[]; searched: boolean }> {
  const target = targetFor(options.density, chapter.level);
  // Search-capable backends are told to use search; the rest get the
  // "only resources you're confident still exist" wording instead.
  const canSearch = await backendSupportsWebSearch();
  const result = await generateWithWebSearch({
    system: resourceSearchSystemPrompt(options.languageName, target, canSearch),
    user: resourceSearchUserPrompt(courseName, chapter, options.excludedUrls),
    maxTokens: options.efficient ? 3000 : 6000,
    efficient: options.efficient,
    maxSearches: options.efficient ? 3 : 5,
  });
  try {
    return { suggestions: normalizeResourceSuggestions(parseJsonFromText(result.text)), searched: result.searched };
  } catch (err) {
    console.warn("Study plan: couldn't parse resource suggestions:", err);
    return { suggestions: [], searched: result.searched };
  }
}

function toNewResource(s: ResourceSuggestion, check: LinkCheckResult): NewResource {
  return {
    kind: s.kind,
    title: s.title,
    url: check.finalUrl,
    provider: s.provider ?? null,
    language: s.language ?? null,
    note: s.note,
    origin: "ai",
    link_status: check.status,
    status_detail: check.detail,
    checked_at: nowUtc(),
  };
}

// Asks for resources, verifies every link, and — if too few survive — asks
// once more with the rejects excluded. Never throws for a bad suggestion;
// an AI/network failure of the call itself does propagate.
export async function findChapterResources(
  courseName: string,
  chapter: ResourceSearchChapter,
  options: { languageName: string; density: ResourceDensity; efficient: boolean }
): Promise<{ resources: NewResource[]; searched: boolean }> {
  const target = targetFor(options.density, chapter.level);
  const kept: NewResource[] = [];
  const seen = new Set<string>();
  const rejected: string[] = [];
  let searched = false;

  for (let attempt = 0; attempt < 2 && kept.length < target.min; attempt++) {
    const { suggestions, searched: didSearch } = await suggestResources(courseName, chapter, {
      ...options,
      excludedUrls: [...rejected, ...kept.map((k) => k.url)],
    });
    searched ||= didSearch;
    const fresh = suggestions.filter((s) => !seen.has(s.url));
    fresh.forEach((s) => seen.add(s.url));
    const checks = await verifyLinks(fresh.map((s) => ({ url: s.url, kind: s.kind })));
    for (const suggestion of fresh) {
      const check = checks.get(linkCheckKey(suggestion));
      if (!check || !isKeepable(check)) {
        rejected.push(suggestion.url);
        continue;
      }
      if (kept.some((k) => k.url === check.finalUrl)) continue;
      kept.push(toNewResource(suggestion, check));
    }
  }
  return { resources: kept.slice(0, target.max), searched };
}

export class StudyPlanNotFoundError extends Error {
  constructor() {
    super("That study plan no longer exists.");
    this.name = "StudyPlanNotFoundError";
  }
}

export async function regenerateChapterResources(planId: number, chapterId: number): Promise<void> {
  const plan = await getStudyPlan(planId);
  const chapter = await getChapter(chapterId);
  if (!plan || !chapter || chapter.plan_id !== planId) throw new StudyPlanNotFoundError();
  const course = await getCourse(plan.course_id);
  const { aiEfficiencyMode, preferredLanguage } = await getAppSettings();
  const { resources } = await findChapterResources(
    course?.name ?? plan.title,
    {
      title: chapter.title,
      summary: chapter.summary,
      subtopics: chapter.subtopics.map((s) => s.text),
      level: chapter.current_level,
    },
    { languageName: languageName(preferredLanguage), density: plan.options.density, efficient: aiEfficiencyMode }
  );
  await replaceAiResources(chapterId, resources);
}

// Re-verifies every link in a plan and records each result. Dead links are
// flagged, not deleted — the user decides whether to remove one or find a
// replacement.
export async function checkPlanLinks(planId: number): Promise<void> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  const resources = plan.chapters.flatMap((c) => c.resources);
  const checks = await verifyLinks(resources.map((r) => ({ url: r.url, kind: r.kind })));
  for (const resource of resources) {
    const check = checks.get(linkCheckKey(resource));
    if (check) await setResourceLinkCheck(resource.id, { status: check.status, detail: check.detail, url: check.finalUrl });
  }
  await setPlanLinksCheckedAt(planId, nowUtc());
}
