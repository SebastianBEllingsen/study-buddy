import { getCourse, listDocumentSummariesForCourse, listNotesForCourse } from "@/lib/models";
import { latestConflictCheck, newSourceCount, sourceKey } from "@/lib/sources/conflicts";
import { listCourseFlags } from "@/lib/sources/flagStore";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// The course's sources page: every document with its trust, every note
// with whether it feeds generation, the items held out of review, and the
// latest conflict check.
export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  const course = courseId === null ? undefined : await getCourse(courseId);
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 });
  const [documents, notes, flags, check] = await Promise.all([
    listDocumentSummariesForCourse(course.id),
    listNotesForCourse(course.id),
    listCourseFlags(course.id),
    latestConflictCheck(course.id),
  ]);
  const extracted = documents.filter((d) => d.status === "extracted");
  const generationNotes = notes.filter((n) => n.generation_source && n.markdown.trim());
  const currentKeys = [
    ...extracted.map((d) => sourceKey({ kind: "document", id: d.id })),
    ...generationNotes.map((n) => sourceKey({ kind: "note", id: n.id })),
  ];
  return Response.json({
    course: { id: course.id, name: course.name },
    documents: documents.map((d) => ({ id: d.id, filename: d.filename, trust: d.trust, status: d.status })),
    notes: notes.map((n) => ({ id: n.id, title: n.title, icon: n.icon, generationSource: n.generation_source })),
    flags,
    check: check && { ...check, newSources: newSourceCount(currentKeys, check.sourceKeys) },
    comparableSources: currentKeys.length,
  });
}
