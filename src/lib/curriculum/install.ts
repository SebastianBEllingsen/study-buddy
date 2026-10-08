import { createCourse, getAppSettings, listCourseSummaries } from "../models";
import { PRESET_DEFAULTS } from "../studyPlan/options";
import { replaceStudyPlan } from "../studyPlan/store";
import { CURRICULA, curriculumChapters } from "./chapters";

// Installs a built-in curriculum: a course with a ready-made study plan —
// no AI call, no uploaded material needed. The plan then works like any
// other (chapters to tick off, practice per chapter, schedule, review
// queue); code exercises for a chapter are generated from it on demand.

export interface InstalledCurriculum {
  courseId: number;
  // True when the course was already there and nothing was changed.
  alreadyInstalled: boolean;
}

export async function installCurriculum(id: string): Promise<InstalledCurriculum> {
  const curriculum = CURRICULA[id];
  if (!curriculum) throw new Error(`Unknown curriculum: ${id}`);
  // Installing twice must not make a second copy, or replace progress.
  const existing = (await listCourseSummaries()).find((c) => c.name === curriculum.courseName);
  if (existing) return { courseId: existing.id, alreadyInstalled: true };

  const course = await createCourse(curriculum.courseName);
  const settings = await getAppSettings();
  await replaceStudyPlan({
    courseId: course.id,
    title: curriculum.planTitle,
    status: "ready",
    // The same setup as a plan made the usual way: the roadmap preset with
    // practice on and no schedule — Today only offers a scheduled plan's
    // chapters from its dated sessions, so a schedule that doesn't exist yet
    // would show nothing; unscheduled, Today picks the next chapter itself.
    // codeLanguage adds coding practice to Today.
    options: { ...PRESET_DEFAULTS.roadmap, practice: true, codeLanguage: curriculum.language },
    syllabusDocumentId: null,
    syllabusText: null,
    sourceDocumentIds: [],
    sourceFolderId: null,
    sourceHandpicked: false,
    language: settings.preferredLanguage,
    modelProvider: null,
    modelName: null,
    usedWebSearch: false,
    linksCheckedAt: null,
    chapters: curriculumChapters(curriculum),
  });
  return { courseId: course.id, alreadyInstalled: false };
}

