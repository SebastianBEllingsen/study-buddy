// Shared rules for how generation weighs its material. Every section of the
// material is headed with its kind, name and trust (see sourceHeader in
// lib/context.ts): authoritative material (a course's own material, a
// textbook, official documentation), or the learner's personal notes, which
// may contain mistakes.
export const SOURCE_TRUST_RULE = `Each section of the material is headed "--- Document: <name> [<trust>] ---" or "--- Note: <name> [<trust>] ---". [authoritative material] is a trusted reference — for example a course's own material, a textbook, or official documentation. [personal notes] are the learner's own notes: use them, but they may contain mistakes. Where sources disagree, follow the authoritative material. Never turn a claim that appears only in personal notes into an item if it contradicts the authoritative material or well-established knowledge of the subject — leave it out.`;

export const SOURCE_NAME_RULE =
  'Set "source" to the exact <name> from the header of the section the item is based on (e.g. "chapter-3.pdf"), without the brackets.';
