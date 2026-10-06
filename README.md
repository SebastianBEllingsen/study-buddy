# 📚 Study Buddy

**Turn your course PDFs into notes, quizzes, and flashcards.**

Upload the PDFs for a course and generate study material scoped strictly to that material — then plan your study, practise with exams and drills, and track what you actually know. Local-first, with your own AI credentials.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript) ![SQLite](https://img.shields.io/badge/SQLite-local--first-lightblue?logo=sqlite)

<img src="docs/images/Dashboard.png" width="100%" alt="Study Buddy dashboard">

## Contents

- [Features](#features)
  - [Study material](#study-material)
  - [Planning & readiness](#planning--readiness)
  - [Practice](#practice)
  - [Tools](#tools)
  - [Data, storage & customization](#data-storage--customization)
- [Getting started](#getting-started)
  - [Connect an AI backend](#connect-an-ai-backend)
  - [Connect Google Calendar (optional)](#connect-google-calendar-optional)
- [How to use it](#how-to-use-it)
- [Tech stack](#tech-stack)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Features

### Study material

- 🗂️ **Courses & folders** — upload documents (PDF, DOCX, ODT, PPTX) or images (PNG, JPG, GIF, WEBP), organize them however you like, drag to reorder, rename in place

  <img src="docs/images/CoursePage1.png" width="500" alt="Course page with folders">

- 🔗 **Wiki-style notes** — an Obsidian-inspired editor: live-preview markdown, `[[note]]` links with backlinks, and embedded references to a PDF, generated item, or pasted image (optionally anchored to a specific line/sentence). LaTeX now renders live as you type — `$...$`/`$$...$$` conceal into real KaTeX right in the editor, not just Preview — with Overleaf-style `\command` autocomplete for fractions, sums, greek letters, and more

  <img src="docs/images/NotesView.png" width="600" alt="Note with headings, a wikilink, an embedded document reference, LaTeX, and an inline image">

- 📝 **Notes, quizzes & flashcards** — generated from your own material, one click each; save a question-type mix (MCQ / multi-select / short answer) as a reusable quiz preset

  <img src="docs/images/CoursePage2.png" width="500" alt="Generating notes, a quiz, or flashcards from a course">
  <img src="docs/images/QuizGenerationSettings.png" width="380" alt="Quiz settings, with a saved question-type preset">

- ✅ **Quiz grading** — MCQ graded instantly, short answers graded by AI once you turn on **AI grading** in Settings (until then a simple keyword match against the model answer is used, and says so), with a **"Retry what you got wrong"** button for fresh practice on missed concepts

  <table>
    <tr>
      <td><img src="docs/images/QuizMidAttempt.png" width="500" alt="Quiz mid-attempt"></td>
      <td><img src="docs/images/QuizGrading.png" width="500" alt="Quiz graded, with retry and supplement options"></td>
    </tr>
  </table>

- 🧠 **Real spaced repetition** — flashcards only show what's actually due

  <table>
    <tr>
      <td><img src="docs/images/FlashCardFront.png" width="500" alt="Flashcard front"></td>
      <td><img src="docs/images/FlashCardBack.png" width="500" alt="Flashcard back"></td>
    </tr>
  </table>

- 🗃️ **Anki import & export** — upload an `.apkg` (any Anki version's export) and each deck inside becomes a flashcard set, images/audio/video included; **Export to Anki** on any flashcard set downloads it back as an `.apkg`. Review history isn't carried across.

- 💡 **On-demand hints & explanations** — highlight anything for a hint or explanation, never spoiling an unanswered question

  <img src="docs/images/HighlightAndExplainOnPdf.png" width="600" alt="Highlighting text in a PDF to ask for an explanation">

- ✂️ **Crop & Ask** — select a region of any PDF, note, or document and ask AI about just that — works everywhere Ask AI does

  <img src="docs/images/CropAndAskOnPdfViewer.png" width="600" alt="Cropping a region of a PDF to ask AI about it">

- 💬 **A general AI chat, too** — not just per-document Q&A: a persistent assistant independent of any course, with its own saved conversation history for whatever you want to ask. Attach images, PDFs, or DOCX files right in the chat (paste, drag-drop, or the paperclip), optionally scope a conversation to one course so it can answer using that course's material, and ask it in plain English to file something away — *"create a folder called Week 3 and save that PDF there"* — it always proposes what it's about to do and waits for you to confirm before creating or saving anything. Math renders live via LaTeX here too.

  <img src="docs/images/AiChatDialogModal.png" width="500" alt="AI chat scoped to a course, proposing a folder/save action with Confirm and Cancel, alongside an attached image">
  <img src="docs/images/SaveAttachmentToCourse.png" width="500" alt="Filing a chat attachment into a course and folder via the Save to course dialog">

- 📋 **Paste text or images** — paste a raw Ctrl+A page dump (an LMS assignment page, a lecture site, anything) and hit **Make pretty**: it discards the navigation/footer/boilerplate and keeps only the real content, cleanly formatted — save it as a document (which renders that Markdown and LaTeX live, same as a note) or straight into a note, and paste/drop an image to embed it inline either way. Handy for pulling LaTeX out of pages that render maths with MathJax, where a plain copy loses the formulas.

  <img src="docs/images/PasteTextFunctionalityMessyInput1.png" width="380" alt="Pasting a raw page dump, with Save as: Document/Note">

  <table>
    <tr>
      <td><img src="docs/images/PasteTextFunctionalityMessyInput2.png" width="500" alt="Before: raw page dump"></td>
      <td><img src="docs/images/PasteTextFunctionalityMessyInputResult.png" width="500" alt="After: Make pretty extracts just the assignment"></td>
    </tr>
  </table>

- 📅 **Google Calendar & ICS feeds** — connect your own Google Calendar (read + write) and see it as a real month grid inside the app, or subscribe to a read-only ICS feed (a university portal's timetable, an LMS's assignment export) alongside it

  <img src="docs/images/CalenderNoEvents.png" width="600" alt="Calendar month view">

- 🧩 **Customizable home screen** — a phone-widget-style dashboard (pictured up top): a streak heatmap, an "Upcoming events" agenda, and more, each toggleable and drag-to-reorder from Settings — with an optional transparent mode so widgets blend into the dashboard backdrop instead of sitting on cards

  <img src="docs/images/CustomizeWidgets.png" width="400" alt="Dragging and resizing dashboard widgets">

- ➕ **Supplement, don't regenerate** — add newly-uploaded documents to an existing quiz/deck/notes instead of starting over

  <img src="docs/images/SupplementToFlashCardsExample.png" width="600" alt="Banner offering to add new material to an existing flashcard set">

- 🔍 **Search** — find any question, flashcard, or note across every course

  <img src="docs/images/SearchShowCase.png" width="450" alt="Fuzzy search across notes, quizzes, flashcards, and documents">

- 🕵️ **Source trust & fact-checking** — generation treats a course's own material as authoritative and your personal notes as supporting only. Newly generated cards and questions are fact-checked and flagged when something looks off; **report** any card or question as wrong and choose to keep, replace, or remove it. Sources that contradict each other can be compared and listed

  <img src="docs/images/SourcesAccuracy.jpg" width="600" alt="Sources and accuracy page with a flagged flashcard and official/personal trust toggles">

  <img src="docs/images/FlashcardsFactCheck.jpg" width="600" alt="A flashcard held out of review by the fact-check, with Fix, Edit, Keep and Remove options">
- 👁️ **Page transcription** — for slides, scans, or handwritten notes with no usable text layer, have a vision model read the pages into Markdown with the maths as LaTeX, so they can be used as source material
- 🤖 **Bring your own AI** — Anthropic, OpenAI, or Gemini API keys; Claude Code or Codex CLI subscriptions; or a free tier via OpenRouter. Claude Code/Codex normally run hardened (no file, shell, or network access, since they're fed your own uploaded material) — flip on **full tool access** in Settings if you'd rather they handle images directly too (Crop & Ask, chat attachments), confined to a disposable workspace folder, never your project files or database

  <img src="docs/images/SettingsMenuAIProvider.png" width="380" alt="AI provider settings, with the full tool access toggle shown for Claude Code">

### Planning & readiness

- 🗺️ **Study plans** — turn a course into a chapter-by-chapter roadmap: the AI finds web resources per chapter (checked for dead or blocked links), can ask what you already know first, and offers a short pre-test quiz per chapter. Spread chapters over dated sessions around your deadline and chosen weekdays, and replan when you fall behind. Quiz, flashcard, and notes buttons per chapter feed a mastery score

  <img src="docs/images/StudyPlanSchedule.jpg" width="600" alt="Study plan with staged chapters and a dated schedule">
- ☀️ **Today** — a daily autopilot built from your plan and what's due: start a session, work through its steps, and see how much focus time it took alongside the Pomodoro timer. Chapters you already know count as completed

  <img src="docs/images/DashboardToday.jpg" width="600" alt="Home screen with the Today autopilot, streak heatmap, and course list">
- 🎯 **Readiness & exam mode** — a forecast of how prepared you are for each course; in the last weeks before an exam, Today shifts to schedule mock exams at roughly 14, 7, and 3 days out

  <img src="docs/images/ExamReadiness.jpg" width="500" alt="Exam readiness forecast with per-concept recall">
- 📈 **Insights** — confidence calibration (how often "sure" was actually right) and a weekly review

  <img src="docs/images/YourWeek.jpg" width="450" alt="Weekly review with confidence calibration">
- ❌ **Mistakes** — one place to revisit everything you got wrong across courses

  <img src="docs/images/MistakeLog.jpg" width="450" alt="Mistake log with the misconception behind each error">

### Practice

- 🧪 **Mock exams** — analyse a course's past exams (topic weighting, task style, language) and generate a realistic mock exam, or a skill check of the course's topics. Timed attempts; upload photos of handwritten answers and the AI grades them, showing what it read so you can check it

  <img src="docs/images/MockExamPrep.jpg" width="450" alt="Exam prep page with analysed past-exam topic weights">

  <img src="docs/images/MockExamResults.jpg" width="450" alt="A graded mock exam with per-criterion feedback">
- 🧮 **Problem sets** — step-by-step problems in three modes: *worked* (every step shown), *faded* (fill in the blanks), and *independent* (solve alone, with hints per step). Final answers are compared by computer algebra in your browser, so equivalent forms and rounding are recognised

  <img src="docs/images/ProblemSet.jpg" width="450" alt="A fill-in-the-gaps problem with step-by-step checking">
- 🔁 **Drills** — endless practice with fresh numbers every time and answers computed exactly in code, so there's never a wrong answer key

  <img src="docs/images/Drills.jpg" width="450" alt="A drill with freshly generated numbers">
- 💻 **Code exercises** — programming practice in Python or JavaScript, run against tests entirely in your browser. Hidden tests are revealed when you finish, and an AI-written test that a reference solution fails is ignored

### Tools

- 🕸️ **Canvas** — an Obsidian-style infinite canvas for free-form diagrams, plus a concept map generated from a course's chapters and tagged concepts

  <img src="docs/images/CanvasConceptMap.jpg" width="600" alt="A canvas concept map with note cards, groups, and labelled arrows">
- ⚛️ **Quantum playground** — build circuits, see the state vector and Bloch sphere update, and solve build-it challenges checked by the simulator

  <img src="docs/images/QuantumPlayground.jpg" width="600" alt="A Bell-state circuit with the state vector, Bloch spheres and 1000 measurements">
- 🍅 **Pomodoro timer** — focus/break cycles that keep accurate time in background tabs, detachable into its own window
- 🔗 **Links widget** — pin your most-used sites to the home screen, with custom icons

### Data, storage & customization

- ☁️ **Optional Supabase sync** — stays local-first by default, or point it at your own Supabase project to sync across devices, with uploaded files and images kept in Supabase Storage (and migratable between local and cloud storage from Settings)
- 💾 **Automatic backups** — a backup of all your data is made daily while the app runs (or on demand), with the images and files it references, and can be restored from Settings
- 📤 **Full data export** — download every course, note, quiz, and flashcard set — with complete review/attempt history — as one JSON file
- 🎨 **Themes & wallpaper** — pick an app theme, set an app-wide background image with optional blur, and choose frosted or transparent widgets

  <img src="docs/images/SettingsAppearance.png" width="380" alt="Appearance settings: theme, heading font, date format, nav bar color, and backgrounds">
- ⌨️ Small things: press space to flip a flashcard, and Obsidian-style links work across notes

---

## Getting started

```bash
git clone https://github.com/SebastianBEllingsen/study-buddy.git
cd study-buddy
pnpm install
pnpm dev
```

Requires [Node.js](https://nodejs.org) 22.13+ (some dependencies — the SQLite driver, PDF text extraction, Google Calendar — don't support older versions) and [pnpm](https://pnpm.io) (this repo uses `pnpm-lock.yaml` — don't install with `npm`/`yarn`, the lockfiles won't match). Open **http://localhost:3000** — a local SQLite database is created automatically under `data/` on first run and never leaves your machine.

### Connect an AI backend

Pick one from the **settings button** (⚙️) in the header — nothing generates until you do:

| Backend | What you need |
|---|---|
| **Anthropic** (API key) | [console.anthropic.com](https://console.anthropic.com) |
| **Claude Code** (subscription) | `claude` CLI installed, `claude /login` |
| **Codex CLI** (subscription) | `codex` CLI installed, `codex login` |
| **OpenAI** (API key) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Gemini** (API key) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier |
| **Free** (OpenRouter) | [openrouter.ai/keys](https://openrouter.ai/keys) — no card needed |

Keys are stored locally, never sent anywhere except the provider you picked.

### Connect Google Calendar (optional)

Study Buddy can show and manage your real Google Calendar as a month grid inside the app. To connect it, you need your own OAuth client (free, a few minutes):

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen, add the `.../auth/calendar` scope, and add yourself as a test user.
3. Create an **OAuth client ID** (type: Web application) with an authorized redirect URI of `http://localhost:3000/api/calendar/oauth/callback` (swap the host if you're not on the default port/domain — see `NEXT_PUBLIC_APP_URL` below).
4. Paste the generated **Client ID** and **Client secret** into the Calendar section of Settings (⚙️) in the app, then click **Connect**.

Nothing generates or connects until you do this — it's entirely optional. If you deploy the app somewhere other than `http://localhost:3000`, set `NEXT_PUBLIC_APP_URL` to that URL so the OAuth redirect matches.

Don't need write access, or just want a read-only timetable/assignments feed? Skip the OAuth setup entirely and paste an ICS feed URL into the same Calendar section of Settings instead.

### Windows: `Turbopack is not supported (win32/ia32)`

Means Node is installed as 32-bit — almost always the wrong installer on a 64-bit PC. Reinstall 64-bit Node from [nodejs.org](https://nodejs.org). If you must stay on 32-bit, run `pnpm dev:webpack` instead.

---

## How to use it

1. **Create a course**, upload documents (PDF, DOCX, ODT, PPTX) or images into a folder, or paste text/images straight in.
2. **Generate** Notes / Quiz / Flashcards for a folder (or "All course material").
3. **Study** — quizzes grade instantly and offer a retry on what you missed; flashcards only surface what's due; select any text (or crop any region) for a Hint or Explain.
4. **Take your own notes** alongside the generated material — `[[link]]` to other notes, embed a PDF/quiz/flashcard reference, and write LaTeX that renders as you type.
5. **Added more material later?** Open the existing item — a banner offers to add just the new material.
6. **Search** in the header to find anything across every course, or open the AI chat icon for a general question that isn't tied to one document.
7. **Track deadlines** on the Calendar page once Google Calendar or an ICS feed is connected.
8. **Plan your study** — build a study plan for a course, then use **Today** on the home screen to work through each day's steps.
9. **Practise** with mock exams, problem sets, drills, or code exercises, and revisit anything you got wrong under **Mistakes**.

---

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Base UI (shadcn/ui) · CodeMirror · KaTeX · React Flow (canvas) · SQLite (`better-sqlite3`) + optional Supabase/Postgres sync (Drizzle ORM) · Anthropic / OpenAI / Google Gen AI SDKs · Google Calendar API · Vitest

## Known limitations

- No automatic OCR — scanned/image-only PDFs are rejected on upload with a clear message, and a directly-uploaded image is viewable and Crop & Ask-able but isn't used as generation source material. Run **page transcription** on a document with an AI backend that supports images to make it usable
- Anki import/export doesn't carry review history across
- Code exercises run in your browser, so only the languages it supports (Python, JavaScript) are available
- PDF and DOCX work out of the box. ODT and PPTX need a local [LibreOffice](https://www.libreoffice.org/) install (`soffice` on your PATH) — they're converted to PDF on upload for viewing and text extraction; without it, uploading one fails with a clear error instead
- The AI chat's file-management ("create a folder and save this there") handles one create-folder-and/or-save request at a time — no move/rename/delete via chat yet, and if a message both asks a real question and requests a save, only the save proposal gets a reply that turn

## License

No license yet — all rights reserved by default. Ask first if you'd like to reuse this beyond personal use.
