import { getCourse, listDocumentsForCourse } from "@/lib/models";
import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { looksLikePastExam } from "@/lib/exams/analyze";
import { NoExamProfileError, generateMockExam } from "@/lib/exams/generate";
import { getExamProfile, listMockExams } from "@/lib/exams/store";
import { parseDuration } from "@/lib/exams/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

// A course's exam prep: its past-exam profile, its mock exams, and the
// documents that could be analysed as past exams.
export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  try {
    const course = await getCourse(courseId);
    if (!course) return Response.json({ error: "Course not found" }, { status: 404 });
    const [profile, exams, documents] = await Promise.all([
      getExamProfile(courseId),
      listMockExams(courseId),
      listDocumentsForCourse(courseId),
    ]);
    const analysed = new Set(profile?.sourceDocumentIds ?? []);
    return Response.json({
      course: { id: course.id, name: course.name },
      profile,
      exams,
      documents: documents
        .filter((d) => d.status === "extracted")
        .map((d) => ({
          id: d.id,
          filename: d.filename,
          suggested: profile ? analysed.has(d.id) : looksLikePastExam(d.filename),
        })),
    });
  } catch (err) {
    console.error("Loading exam prep failed:", err);
    return Response.json({ error: "Couldn't load exam prep" }, { status: 500 });
  }
}

// Writes a new mock exam. Body: { durationMinutes?: number }.
export async function POST(request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const durationMinutes = parseDuration((await parseJsonObjectBody(request)).durationMinutes);
  if (durationMinutes === null) {
    return Response.json({ error: "durationMinutes must be 10–600" }, { status: 400 });
  }
  try {
    if (!(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
    return Response.json({ exam: await generateMockExam(courseId, { durationMinutes }) }, { status: 201 });
  } catch (err) {
    if (err instanceof NoExamProfileError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Generating a mock exam failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
