import type { Metadata } from "next";

// The window title the timer's own countdown prefix (see PomodoroProvider's
// withTimerTitle) is added to.
export const metadata: Metadata = { title: "Pomodoro" };

export default function DetachedPomodoroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
