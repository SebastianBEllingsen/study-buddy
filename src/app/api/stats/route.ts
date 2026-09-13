import {
  listDueFlashcardItems,
  listGenerationNotifications,
  listStudyDates,
  listStudyActivityCounts,
} from "@/lib/models";
import { computeStreak } from "@/lib/streak";

export async function GET() {
  const [items, notifications, studyDates, activity] = await Promise.all([
    listDueFlashcardItems(),
    listGenerationNotifications(),
    listStudyDates(),
    listStudyActivityCounts(),
  ]);
  const total = items.reduce((sum, item) => sum + item.dueCount, 0);

  return Response.json({
    dueFlashcards: { total, items },
    generationNotifications: notifications,
    streak: computeStreak(studyDates),
    activity,
  });
}
