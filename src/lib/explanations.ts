// Hover explanations for buttons whose effect isn't obvious from the label
// (components/Explain.tsx). All the copy lives here so it stays consistent
// in tone and length: one or two sentences on what happens when you click —
// never a repeat of the label — plus the keyboard shortcut and whether the
// click uses AI.

export interface Explanation {
  text: string;
  shortcut?: string;
  ai?: boolean;
}

export const EXPLANATIONS = {
  // Header
  "nav.review": { text: "One mixed review session of everything that's due, across all your courses." },

  // Today
  "today.length": { text: "How much time you have. Today's steps are fitted to it: reviews first, then mistakes, your plan and a weak concept." },
  "today.start": { text: "Starts the focus timer and opens the first step. The current step stays in the timer menu in the header." },
  "today.week": { text: "Your last seven days: reviews, plan time, and how well your confidence matches your results." },
  "today.go": { text: "Opens this step. Resources open in a new tab." },
  "today.done": { text: "Marks the step done. A plan resource or subtopic is ticked off in your study plan too." },
  "today.later": { text: "Moves this step to the end of today's list." },
  "today.skip": { text: "Drops this step for today." },
  "today.finish": { text: "Ends the session and marks today's study plan sessions done for the chapters you worked on." },

  // Answering: confidence and ratings
  "confidence.guess": { text: "You'd be guessing. Even if you're right, it counts as shaky and comes back sooner.", shortcut: "1" },
  "confidence.unsure": { text: "You think you know it but aren't certain. A right answer comes back a little sooner.", shortcut: "2" },
  "confidence.sure": { text: "You're confident. If you turn out to be wrong, that's a blind spot — it goes in your mistake log.", shortcut: "3" },
  "rating.again": { text: "You didn't recall it. It comes back later in this session and again soon, and goes in your mistake log.", shortcut: "1" },
  "rating.hard": { text: "You got it, but with effort. The next review comes a bit sooner than usual.", shortcut: "2" },
  "rating.good": { text: "You recalled it fine. It's scheduled at the normal interval.", shortcut: "3" },
  "rating.easy": { text: "It was effortless. The next review is pushed further out.", shortcut: "4" },
  "card.why": { text: "Say why the answer is true and get feedback — or just ask. Understanding why makes it stick.", ai: true },
  "quiz.retry": { text: "Makes a new quiz on the ideas behind the questions you got wrong.", ai: true },

  // Mistake log
  "mistakes.explain": { text: "Asks the AI what misunderstanding is behind each unexplained mistake, 20 at a time.", ai: true },
  "mistakes.learned": { text: "Clears it by hand. Mistakes also clear themselves once you get them right on two later days." },
  "mistakes.redo": { text: "A review session of your open mistakes, the ones you were sure about first." },
  "mistakes.open": { text: "Every quiz question you got wrong and card you rated Again, with what you answered." },

  // Course practice
  "course.review": { text: "A review session of this course's due cards and questions only." },
  "course.concepts": { text: "How much of each concept you'd recall right now, weakest first." },
  "course.mistakes": { text: "This course's mistake log." },
  "course.examPrep": { text: "Timed practice tests graded with partial credit — in the style of your past exams, if you add them." },
  "course.problems": { text: "Practise solving problems with support that fades: worked example, fill in the gaps, then on your own." },
  "course.readiness": { text: "Set an exam or goal date and see how much you'd recall on the day." },
  "course.explain": { text: "Test yourself by writing or explaining a topic from memory; the gaps become flashcards." },
  "course.week": { text: "This course's last seven days and how well your confidence matches your results." },

  // Concepts
  "concepts.tag": { text: "Has the AI name the concept each untagged card and question tests, so it counts on this page.", ai: true },
  "concepts.map": { text: "Draws this course's concepts and how they connect onto a new canvas, coloured by how well you recall each.", ai: true },

  // Study plan chapter
  "chapter.quiz": { text: "Makes a quiz on this chapter. Your score feeds its mastery bar.", ai: true },
  "chapter.flashcards": { text: "Makes flashcards on this chapter. They join your daily reviews.", ai: true },
  "chapter.notes": { text: "Writes study notes for this chapter from its material.", ai: true },
  "chapter.blurt": { text: "Write everything you remember about this chapter with no notes, then see what you missed.", ai: true },
  "chapter.explain": { text: "Teach this chapter to an AI novice who asks probing questions, then see what you couldn't explain.", ai: true },
  "chapter.problems": { text: "A coached problem set on this chapter: worked, then faded, then independent.", ai: true },
  "plan.replan": { text: "Moves missed sessions forward and adds review where your quiz and flashcard results are weak.", ai: true },

  // Exam prep
  "exams.analyse": { text: "The AI reads the ticked exams for their style, task types and how points are spread across topics.", ai: true },
  "exams.minutes": { text: "How long the test should take. Defaults to the length of your past exams, or an hour." },
  "exams.write": { text: "Writes a new test — like your past exams if analysed — leaning toward your weak concepts, with a rubric per task.", ai: true },
  "exams.start": { text: "Starts the exam clock. You can pause it from the exam page." },
  "exams.discard": { text: "Throws this attempt away so you can start fresh. Nothing is graded." },
  "exams.pause": { text: "Stops the clock and hides the tasks until you resume." },
  "exams.photo": { text: "Take or upload a photo of your written work. The grader reads it, so clear handwriting helps." },
  "exams.handIn": { text: "Ends the exam and grades each task against its rubric, with partial credit.", ai: true },

  // Readiness
  "readiness.suggestion": { text: "Use this calendar event's date as the exam date." },

  // Blurt / explain
  "explain.blurt": { text: "Write everything you remember, no notes. You'll see which ideas you covered, half-covered or missed." },
  "explain.feynman": { text: "Teach the topic to a curious novice who asks up to five probing questions." },
  "explain.finish": { text: "Stops the questions and shows what you couldn't explain.", ai: true },

  // Problems
  "problems.coached": { text: "A worked example, one with gaps to fill, then two to solve alone with hints. Support fades as you go.", ai: true },
  "problems.mixed": { text: "Problems from your weakest topics, shuffled, so you practise picking the right method.", ai: true },
  "problems.check": { text: "Checks your working against the model solution. Only your first attempt counts toward your reviews.", ai: true },
  "problems.hint": { text: "Shows a hint for the next step. Solving with hints counts as less secure in your reviews." },
  "problems.showStep": { text: "Shows the missing step so you can study it." },
  "problems.showSolution": { text: "Shows the full solution. The problem counts as not solved in your reviews." },
  "problems.studied": { text: "Marks the worked example as studied and moves on to the next problem." },

  // Code exercises
  "course.code": { text: "Write code and run it against tests in your browser, from a warm-up to harder exercises." },
  "code.write": { text: "Writes four exercises that build on each other, each with tests, hints and a reference solution.", ai: true },
  "code.run": { text: "Runs your code against the tests in your browser (Ctrl+Enter). Passing them all finishes the exercise." },
  "code.hint": { text: "Shows the next hint. Finishing with hints counts as less secure in your reviews." },
  "code.reveal": { text: "Shows the reference solution. Before you've passed, it counts as not solved in your reviews." },
  "code.reset": { text: "Puts the starter code back. Your current code is replaced." },

  // Sources and accuracy
  "course.sources": { text: "Which documents and notes generation uses and how far it trusts each, plus items held back as possibly wrong." },
  "item.report": { text: "Takes it out of your reviews until it's fixed, and clears the mistakes it caused." },
  "flag.fix": { text: "Rechecks it against its source and suggests a correction. Nothing changes until you accept.", ai: true },
  "flag.edit": { text: "Correct it by hand. A fixed item comes back up for review straight away." },
  "flag.keep": { text: "It's right after all: clears the flag and returns it to your reviews." },
  "flag.remove": { text: "Deletes it from the set, along with its review history." },
  "sources.check": { text: "Compares your documents and notes and lists where they contradict each other.", ai: true },
  "sources.trust": { text: "Official material is treated as authoritative. Personal notes support it but never override it." },
  "note.generation": { text: "Whether new cards, quizzes and notes for this course can draw on this note, and how far to trust it." },
} satisfies Record<string, Explanation>;

export type ExplanationId = keyof typeof EXPLANATIONS;
