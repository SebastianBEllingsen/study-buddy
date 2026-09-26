"use client";

import { cn } from "cn";
import type { StudyPlanChapter } from "@/lib/studyPlan/types";
import { groupStages } from "@/lib/studyPlan/roadmap";
import { chapterIsComplete } from "@/lib/studyPlanDisplay";

// The plan's table of contents: one row per stage, the chapters in it side
// by side (studied in parallel), each a jump link to its card below.
export function RoadmapIndex({
  chapters,
  chapterNumbers,
}: {
  chapters: StudyPlanChapter[];
  chapterNumbers: Map<number, number>;
}) {
  const stages = groupStages(chapters);
  return (
    <nav aria-label="Roadmap" className="space-y-2">
      {stages.map((stage, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="w-14 shrink-0 pt-1 text-xs text-muted-foreground">Stage {i + 1}</span>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {stage.map((chapter) => {
              const done = chapterIsComplete(chapter);
              return (
                <a
                  key={chapter.id}
                  href={`#chapter-${chapter.id}`}
                  className={cn(
                    "rounded-md border px-2 py-1 text-sm transition-colors hover:bg-muted",
                    done && "border-sage/40 bg-sage/10 text-sage"
                  )}
                >
                  {chapterNumbers.get(chapter.id)}. {chapter.title}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
