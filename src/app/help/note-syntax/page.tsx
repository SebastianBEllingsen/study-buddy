import type { Metadata } from "next";
import NoteSyntaxGuide from "@/components/NoteSyntaxGuide";

export const metadata: Metadata = { title: "Note syntax" };

// Detached window for the note header's syntax guide (see NoteSyntaxHelp).
// fixed inset-0 covers the root layout's header, same as the detached note
// and document windows.
export default function NoteSyntaxPage() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background text-sm">
      <div className="mx-auto max-w-2xl px-5 py-5">
        <h1 className="mb-4 font-heading text-lg font-semibold">Note syntax</h1>
        <NoteSyntaxGuide />
      </div>
    </div>
  );
}
