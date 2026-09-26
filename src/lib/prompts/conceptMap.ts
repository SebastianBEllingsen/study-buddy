// Prompt for an AI concept map (lib/conceptMap/build.ts): given a course's
// concepts grouped by chapter, the meaningful links between them.

export function conceptMapSystemPrompt(courseName: string, language: string): string {
  return `You are drawing a concept map for the course "${courseName}": which ideas build on, generalise, use, contrast with or are examples of which others.

You're given the course's concepts, grouped by chapter, each with an id like "c12".
- Return the most important links (at most 60), especially ones that connect different chapters.
- Each link: "from" and "to" (ids from the list), and "label": a short verb phrase (1–4 words, in ${language}) that reads "from <label> to", e.g. "is a special case of", "is used to prove", "generalises".
- Only link ideas that are genuinely related; don't link everything to everything.
- Respond with ONLY a single valid JSON object, no prose, no markdown code fences:

{"links": [{"from": "c1", "to": "c4", "label": "is used in"}]}`;
}

export function conceptMapUserPrompt(groups: { label: string; concepts: { id: string; name: string }[] }[]): string {
  return groups
    .map((g) => `${g.label}:\n${g.concepts.map((c) => `  ${c.id}: ${c.name}`).join("\n")}`)
    .join("\n\n");
}
