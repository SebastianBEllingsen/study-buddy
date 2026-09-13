import { listDueFlashcardItems, listStudyDates, listStudyActivityCounts } from "@/lib/models";
import { computeStreak } from "@/lib/streak";

export async function GET() {
  const [items, studyDates, activity] = await Promise.all([
    listDueFlashcardItems(),
    listStudyDates(),
    listStudyActivityCounts(),
  ]);
  const total = items.reduce((sum, item) => sum + item.dueCount, 0);

  return Response.json({
    dueFlashcards: { total, items },
    streak: computeStreak(studyDates),
    activity,
  });
}
