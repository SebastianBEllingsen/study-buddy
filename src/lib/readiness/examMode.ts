// Exam mode: the last weeks before a course's exam change what the Today
// autopilot plans. Pure and client-safe.

export const EXAM_MODE_DAYS = 21;
export const NO_NEW_MATERIAL_DAYS = 3;
// Mock exams at about 14, 7 and 3 days out: one is due once it's been
// this long since the last one was started.
export const MOCK_EXAM_CHECKPOINTS = [14, 7, 3];

export interface ExamMode {
  active: boolean;
  daysLeft: number;
  noNewMaterial: boolean;
  mockExamDue: boolean;
}

// `lastMockDaysAgo`: days since the last mock exam attempt was started
// (null if never). `canMock`: a mock exam can be written — from analysed
// past exams, or as a skill check of the course's topics.
export function examMode(daysLeft: number | null, lastMockDaysAgo: number | null, canMock: boolean): ExamMode {
  if (daysLeft === null || daysLeft < 0 || daysLeft > EXAM_MODE_DAYS) {
    return { active: false, daysLeft: daysLeft ?? -1, noNewMaterial: false, mockExamDue: false };
  }
  // The checkpoint we're at or past: a mock is due unless one was started
  // since that checkpoint's day.
  // Each checkpoint covers the days up to the next one: 14 → (7, 14],
  // 7 → (3, 7], 3 → (0, 3].
  const checkpoint = MOCK_EXAM_CHECKPOINTS.find((c, i) => daysLeft <= c && daysLeft > (MOCK_EXAM_CHECKPOINTS[i + 1] ?? 0));
  const sinceCheckpoint = checkpoint === undefined ? null : checkpoint - daysLeft;
  const mockExamDue =
    canMock && sinceCheckpoint !== null && (lastMockDaysAgo === null || lastMockDaysAgo > sinceCheckpoint);
  return { active: true, daysLeft, noNewMaterial: daysLeft <= NO_NEW_MATERIAL_DAYS, mockExamDue };
}
