import type { QuizContent, QuizQuestion } from "./types";

// A standalone, dependency-free HTML export of a quiz — see the "Download"
// link on the item page and /api/items/[itemId]/download. Includes the
// answer key inline (correct option(s) highlighted, model answer/
// explanation shown) rather than a blank sheet to print: this app's own
// purpose is reviewing/studying material, not administering a blind test.
// Math notation (`$...$`/`$$...$$`) is left as literal text rather than
// rendered — a real LaTeX renderer would mean bundling one into every
// export, for a case (math-heavy quiz, taken offline) that's the exception
// rather than the rule here.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderQuestion(q: QuizQuestion, index: number): string {
  const header = `<div class="question"><h2>${index + 1}. ${escapeHtml(q.question)}</h2>`;

  if (q.type === "mcq") {
    const options = q.options
      .map((opt, i) => `<li class="${i === q.correctIndex ? "correct" : ""}">${escapeHtml(opt)}</li>`)
      .join("");
    return `${header}<ul class="options">${options}</ul><p class="explanation">${escapeHtml(q.explanation)}</p></div>`;
  }

  if (q.type === "multi_select") {
    const correctSet = new Set(q.correctIndices);
    const options = q.options
      .map((opt, i) => `<li class="${correctSet.has(i) ? "correct" : ""}">${escapeHtml(opt)}</li>`)
      .join("");
    return `${header}<p class="hint">Select all that apply.</p><ul class="options">${options}</ul><p class="explanation">${escapeHtml(q.explanation)}</p></div>`;
  }

  return `${header}<p class="model-answer"><strong>Model answer:</strong> ${escapeHtml(q.modelAnswer)}</p><p class="explanation">${escapeHtml(q.explanation)}</p></div>`;
}

export function renderQuizHtml(title: string, content: QuizContent): string {
  const questions = content.questions.map(renderQuestion).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem 3rem; line-height: 1.5; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; margin-bottom: 1.5rem; }
  h2 { font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem; }
  .question { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid #ddd; }
  .options { list-style: none; padding: 0; margin: 0 0 0.5rem; }
  .options li { padding: 0.3rem 0.5rem; border-radius: 4px; }
  .options li.correct { background: #e6f4ea; color: #1a7f37; font-weight: 600; }
  .options li.correct::before { content: "\\2713  "; }
  .hint { font-size: 0.85rem; color: #666; margin: 0 0 0.5rem; font-style: italic; }
  .model-answer { margin: 0 0 0.4rem; }
  .explanation { font-size: 0.9rem; color: #555; margin: 0; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${questions}
</body>
</html>`;
}
