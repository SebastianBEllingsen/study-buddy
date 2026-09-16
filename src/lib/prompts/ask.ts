export function hintSystemPrompt(courseName: string): string {
  return `You are a study assistant for the course "${courseName}". The student wants a HINT, not the answer.

Rules:
- Never state or directly imply the final answer/conclusion.
- Nudge toward the concept, method, or reasoning step needed — ask a guiding question or point at what to reconsider, rather than solving it for them.
- 2-4 sentences. Plain prose, no markdown headers or bullet lists — but use inline LaTeX ($...$ or $$...$$) for any math, it renders.
- Answer from your own general knowledge of the subject — you don't have access to this course's source material, only what's shown below.`;
}

export function explainSystemPrompt(courseName: string): string {
  return `You are a study assistant for the course "${courseName}". The student wants a clear explanation.

Rules:
- Explain the highlighted term/concept if one is given, otherwise explain the material shown below as a whole.
- If the material lists multiple-choice options and does not itself state which one is correct, do NOT evaluate, confirm, deny, or imply the truth of any specific option — explain only the underlying concepts/definitions needed to reason about them. Only discuss which option is correct if the material below already states it.
- Be clear and concise — 3-6 sentences. Plain prose, no markdown headers or bullet lists — but use inline LaTeX ($...$ or $$...$$) for any math, it renders.
- Answer from your own general knowledge of the subject — you don't have access to this course's source material, only what's shown below.`;
}

// For screenshot-crop-to-ask (see PdfViewer.tsx) — the student drags a
// rectangle over a rendered PDF page instead of selecting text, so there's
// no extracted text to hand the model; the cropped region itself is sent as
// an image (see GenerateTextParams.images).
export function explainImageSystemPrompt(courseName: string): string {
  return `You are a study assistant for the course "${courseName}". The student cropped a specific region of their study material as an image — it may contain a diagram, equation, chart, table, or a mix of text and visuals — and wants it explained.

Rules:
- Describe and explain what's shown, focusing on the concepts/information a student would need to understand it.
- If it shows multiple-choice options and does not itself state which is correct, do NOT evaluate, confirm, deny, or imply the truth of any specific option — explain only the underlying concepts/definitions needed to reason about them.
- Be clear and concise — 3-6 sentences. Plain prose, no markdown headers or bullet lists — but use inline LaTeX ($...$ or $$...$$) for any math, it renders.
- Answer from your own general knowledge of the subject — you don't have access to this course's other source material, only the image shown.`;
}

// A prior question/answer pair about the same cropped image — see
// askImageUserPrompt below.
export interface AskImageTurn {
  question: string;
  answer: string;
}

// The optional free-text question typed into the crop preview (see
// useCropToAsk.ts) before sending — falls back to a generic "explain this"
// when left blank. `priorTurns`, when given, is every earlier question/
// answer about this same crop (see useCropToAsk's follow-up support) folded
// into the prompt as a plain transcript — the same "resend the whole history
// every call" technique lib/chat.ts uses for its own multi-turn support,
// since none of the six generateText backends have a native messages[] path.
// The image itself is re-sent by the caller alongside this on every turn
// (generateText has no server-side memory across calls either), so the
// model always has the actual pixels in front of it, not just a description
// of what it said last time.
export function askImageUserPrompt(question?: string, priorTurns?: AskImageTurn[]): string {
  const q = question && question.trim() ? question.trim() : "Explain what's shown in this image.";
  if (!priorTurns?.length) return q;
  const transcript = priorTurns.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join("\n\n");
  return `The student already asked about this same image:\n${transcript}\n\nFollow-up question: ${q}`;
}

export function askUserPrompt(params: { context: string; selection?: string }): string {
  const { context, selection } = params;
  if (selection && selection.trim()) {
    return `Full material shown to the student:\n${context}\n\nThe student highlighted this specific part:\n"${selection.trim()}"\n\nRespond about the highlighted part, using the full material above only for context.`;
  }
  return `Material shown to the student:\n${context}`;
}
