import { listDueFlashcardItems, listGenerationNotifications, listStudyActivity } from "@/lib/models";
import { computeStreak } from "@/lib/streak";

export async function GET() {
  const [items, notifications, studyActivity] = await Promise.all([
    listDueFlashcardItems(),
    listGenerationNotifications(),
    listStudyActivity(),
  ]);
  const total = items.reduce((sum, item) => sum + item.dueCount, 0);

  return Response.json({
    dueFlashcards: { total, items },
    generationNotifications: notifications,
    streak: computeStreak(studyActivity.dates),
    activity: studyActivity.counts,
  });
}
