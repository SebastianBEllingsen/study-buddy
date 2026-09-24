import {
  Activity,
  CalendarClock,
  CalendarDays,
  Clock,
  Flame,
  Layers,
  Link2,
  ListChecks,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type { HomeWidgetId } from "./models";

// Display metadata for home dashboard widgets — shared between the home
// page itself and the customize dialog's preview tiles, so both always
// agree on a widget's name/icon.
export const HOME_WIDGET_META: Record<HomeWidgetId, { label: string; icon: LucideIcon }> = {
  streak: { label: "Study streak", icon: Flame },
  due: { label: "Due cards", icon: Layers },
  heatmap: { label: "Study heatmap", icon: Activity },
  calendar: { label: "Upcoming events", icon: CalendarDays },
  assignments: { label: "Assignments", icon: ListChecks },
  recent: { label: "Recent activity", icon: Clock },
  pomodoro: { label: "Pomodoro", icon: Timer },
  links: { label: "Links", icon: Link2 },
  timetable: { label: "Timetable", icon: CalendarClock },
};
