// Client-safe: shared by the analyser and the past-exam picker.

const STRONG = /\b(exam|exams|final|finals|eksamen|examen|pr[uü]fung|klausur|tentamen|esame)\b/i;
const WEAK = /\b(midterm|test|quiz)\b/i;

function words(filename: string): string {
  return filename.replace(/[_\-.+]+/g, " ");
}

// How exam-like a filename is: 2 for "exam"-style names, 1 for tests and
// midterms, 0 otherwise.
export function pastExamRank(filename: string): number {
  const w = words(filename);
  return STRONG.test(w) ? 2 : WEAK.test(w) ? 1 : 0;
}

// A starting guess for the picker: filenames that look like past exams.
export function looksLikePastExam(filename: string): boolean {
  return pastExamRank(filename) > 0;
}

// Calendar events that look like an exam, to suggest a course's exam date.
export function looksLikeExamEvent(title: string): boolean {
  const w = words(title);
  return STRONG.test(w) || /\bmidterm\b/i.test(w);
}
