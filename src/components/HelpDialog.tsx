"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// One centralized "how does this app work" overview — the point being that
// individual dialogs/menus elsewhere (Settings, the note editor toolbar,
// widget customization, ...) can stay lean and self-evident instead of each
// growing its own explanatory copy/mini-tutorial. Kept intentionally short:
// this is a map of where things live, not a manual — same "concise
// overview" scope as the README's own "How to use it" section, which this
// mirrors, not replaces.
function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export default function HelpDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon-sm" aria-label="Help" onClick={() => setOpen(true)}>
        <HelpCircle className="size-4 text-muted-foreground" />
      </Button>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick guide</DialogTitle>
          <DialogDescription>
            The short version — everything here has more detail in place once you&apos;re using it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          <HelpSection title="Courses & material">
            Create a course, then upload PDFs (or paste text/images) into folders. Drag things
            between folders to reorganize. Folders can hold subfolders as many levels deep as you
            like — drop a folder onto another folder&apos;s name to nest it inside.
          </HelpSection>
          <HelpSection title="Generate">
            From a folder — or &quot;All course material&quot; — generate Notes, a Quiz, or
            Flashcards with one click. Uploaded more PDFs later? Open the existing set and a banner
            offers to add just the new material instead of starting over.
          </HelpSection>
          <HelpSection title="Study plan">
            Under Practice, &quot;Study plan&quot; turns a syllabus (a course document or pasted text)
            into a roadmap of chapters to work through, each with a checklist and web resources to
            study in order. Every link is checked. &quot;Full guided&quot; also asks what you already
            know, adds a quiz/flashcards/notes &quot;Test yourself&quot; to each chapter (your results
            become its mastery), and spreads the chapters over a study schedule that shows on your
            calendar — Replan moves missed sessions and adds review where you&apos;re weak. Upload new
            lectures later and the plan offers to fold them in. The plan&apos;s language follows
            Settings → AI → Preferred language.
          </HelpSection>
          <HelpSection title="Study">
            Quizzes grade instantly and offer a &quot;Retry what you got wrong&quot;. Flashcards
            only surface what&apos;s actually due, using real spaced repetition. Select any text (or
            crop a region of a PDF) for a hint or explanation.
          </HelpSection>
          <HelpSection title="Today">
            The Today card on the dashboard (and on each course) plans one session to fit the minutes
            you pick: due reviews first, then mistakes you were sure about, then the next step of
            your study plan, then your weakest concept. Start runs the focus timer and opens each step
            in turn; the timer in the header shows the current step with Done, Later and Skip. Missed
            plan days are rescheduled for you.
          </HelpSection>
          <HelpSection title="Exam prep">
            From a course&apos;s Exam prep page, pick its past exams and the AI works out their style,
            task mix and how the points are spread across topics. It then writes new mock exams to
            match, each with a rubric and model solution. No past exams, e.g. when learning on your
            own? It writes skill checks of your study plan&apos;s chapters, practised concepts or
            material instead. Take one under time, typing your answers or
            photographing handwritten work, and it&apos;s graded task by task with partial credit.
            Every task then joins your spaced review, and lost points land in the Mistake log.
          </HelpSection>
          <HelpSection title="Blurt, explain, readiness">
            On a course (or a study plan chapter), Blurt has you write everything you remember
            without notes, and &quot;Explain it&quot; has you teach the topic to an AI novice who asks
            probing questions. Either way, the gaps become cards in a &quot;Gap cards&quot; deck. Readiness
            projects how much you&apos;d recall on the day. Set an exam or goal date there, and Today switches
            to exam mode for the last three weeks: more mixed practice, mock exams about 14, 7 and
            3 days out, and no new material in the final days. &quot;Your week&quot; shows your
            activity, how your confidence matches your results, and your top misconceptions.
          </HelpSection>
          <HelpSection title="Problems, concept maps, why">
            Problems (on a course or a plan chapter) teaches a method by fading support: a worked
            example, one where you fill in the missing steps, then two to solve on your own with
            step-by-step hints. Mixed sets shuffle problems from your weakest topics so you practise
            choosing the method. Solved problems join your spaced review. The Concepts page can
            draw a concept map onto a canvas, coloured by how well you recall each idea. On a
            revealed flashcard, &quot;Why?&quot; checks your reasoning and explains why the answer holds.
          </HelpSection>
          <HelpSection title="Code exercises">
            For programming, a course&apos;s Code page writes Python or JavaScript exercises on a
            chapter or topic, from a warm-up to something harder. Write your code in the editor and run
            it against the tests; hints and the reference solution are there when you&apos;re stuck. Code
            runs only in your browser, cut off from the internet — nothing runs on a server. Tests the
            reference solution itself fails are skipped as likely wrong. Finished exercises join your
            reviews.
          </HelpSection>
          <HelpSection title="Review">
            Review in the header runs one mixed session over everything due: cards, plus quiz
            questions you&apos;ve answered before, scheduled with FSRS so each comes back just
            before you&apos;d forget it. Say how sure you are before seeing the answer. What you
            miss comes back until you get it and lands in the Mistake log, which can explain the
            misconception behind each. A course&apos;s Concepts page shows how much of each topic
            you&apos;d recall right now. Target recall and new cards a day are in Settings → Courses.
          </HelpSection>
          <HelpSection title="Sources and accuracy">
            A course&apos;s Sources page sets what generation trusts. Documents count as official
            material unless you mark them personal. Vault notes are left out unless you include them,
            from the note&apos;s toolbar or here: official for notes copied from course material, a textbook or official docs,
            personal for your own. Where sources disagree, official material wins. New cards and
            questions are fact-checked, and anything doubtful is held out of your reviews. Each one
            links to its source, and &quot;This is wrong&quot; during review holds it back too. Fix
            held-back items with AI or by hand, keep them, or remove them. &quot;Compare sources&quot;
            lists where your documents and notes contradict each other.
          </HelpSection>
          <HelpSection title="Pomodoro timer">
            The timer icon in the header starts a focus session that keeps running on every page;
            the gear sets your lengths, and its buttons open a fullscreen focus view or pop the timer
            out into its own window.
          </HelpSection>
          <HelpSection title="The Vault">
            Your own Obsidian-style notes, separate from generated material. Type{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">[[</code> to link another note,
            document, or generated item. Toggle Edit/Preview with the buttons in the note&apos;s own
            toolbar, or{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              ⌘E
            </kbd>
            .
          </HelpSection>
          <HelpSection title="Calendar">
            Connect your own Google Calendar (Settings) or subscribe to a read-only ICS feed (your
            school&apos;s deadline calendar, for example) to see and manage deliverables from the
            Calendar page and the dashboard widgets.
          </HelpSection>
          <HelpSection title="Your dashboard">
            Click Customize on either widget grid (above or below your course list) to add, move,
            resize, or hide widgets — streak, due cards, upcoming events, assignments, recent
            activity, and more.
          </HelpSection>
          <HelpSection title="AI backend">
            Pick one from Settings — an API key (Anthropic, OpenAI, Gemini), a Claude Code/Codex
            CLI subscription, or a free tier via OpenRouter. Nothing generates until you do.
          </HelpSection>
          <HelpSection title="Shortcuts">
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              ⌘K
            </kbd>{" "}
            or{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              /
            </kbd>{" "}
            — search anything, anywhere.{" "}
            <kbd className="rounded border border-border bg-muted px-1 font-sans text-[0.7rem]">
              ⌘E
            </kbd>{" "}
            — toggle Edit/Preview in a note.
          </HelpSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
