import { chunkText, estimateTokens } from "./chunking";

// Lightweight, dependency-free retrieval over a course's documents and notes,
// used by the chat assistant (see context.ts's buildChatCourseContext) so a
// message only carries the parts of the course it's actually about — instead
// of the whole course on every turn.

// One document or note: `header` is its "--- Document: x.pdf (Folder) ---"
// line, `body` its text (null for an image / not-yet-extracted document).
export interface CourseSection {
  kind: "document" | "note";
  title: string;
  header: string;
  body: string | null;
  // Short extra detail for the outline line, e.g. "image, no extracted text".
  note?: string;
}

// A whole course at or under this many tokens is just sent in full — cheap
// enough, and better than risking a missed excerpt on a tiny course.
export const SMALL_COURSE_TOKENS = 4_000;
// Budget for the excerpts of a larger course, in tokens.
const EXCERPT_BUDGET_TOKENS = 6_000;
const MAX_EXCERPTS = 12;
// A document/note the user names outright is included whole up to this size;
// past it only its best passages are.
const NAMED_SECTION_MAX_TOKENS = 10_000;
const PASSAGE_TOKENS = 350;
// A passage must score at least this fraction of the best one to be included.
const RELATIVE_SCORE_CUTOFF = 0.35;

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can could do does did for from had has have how i if in into is it its just me my " +
    "no not of on or our please so some than that the their them then there these they this to us was we were what " +
    "when where which who why will with would you your about also any more most other should tell give show explain " +
    "og i en et er på til av for med som det den de ikke har jeg du vi kan skal hva hvordan hvorfor hvilken"
  ).split(" ")
);

export function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.filter((t) => !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)));
}

interface Passage {
  section: number;
  index: number;
  text: string;
  terms: Map<string, number>;
  length: number;
}

function buildPassages(sections: CourseSection[]): Passage[] {
  const passages: Passage[] = [];
  sections.forEach((section, s) => {
    if (!section.body) return;
    chunkText(section.body, PASSAGE_TOKENS).forEach((text, index) => {
      const tokens = tokenize(text);
      const terms = new Map<string, number>();
      for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
      passages.push({ section: s, index, text, terms, length: tokens.length });
    });
  });
  return passages;
}

// Okapi BM25 of every passage against the query terms.
function scorePassages(passages: Passage[], queryTerms: string[]): number[] {
  const n = passages.length;
  const avgLength = passages.reduce((sum, p) => sum + p.length, 0) / Math.max(n, 1) || 1;
  const k1 = 1.4;
  const b = 0.75;
  // How many passages hold each query term — counted once, not per passage.
  const uniqueTerms = [...new Set(queryTerms)];
  const docFrequency = new Map(
    uniqueTerms.map((term) => [term, passages.reduce((c, q) => c + (q.terms.has(term) ? 1 : 0), 0)])
  );
  return passages.map((p) => {
    let score = 0;
    for (const term of uniqueTerms) {
      const tf = p.terms.get(term);
      if (!tf) continue;
      const df = docFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * p.length) / avgLength)));
    }
    return score;
  });
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

// Sections whose file name / title the query spells out ("in Lecture 4.pdf",
// "my Automata note"). Compared on normalized tokens so punctuation and the
// extension don't matter.
function namedSections(sections: CourseSection[], query: string): Set<number> {
  const queryTokens = tokenize(query).join(" ");
  const named = new Set<number>();
  sections.forEach((section, i) => {
    const titleTokens = tokenize(stripExtension(section.title)).join(" ");
    if (titleTokens.length >= 3 && ` ${queryTokens} `.includes(` ${titleTokens} `)) named.add(i);
  });
  return named;
}

function outline(sections: CourseSection[]): string {
  if (sections.length === 0) return "(this course has no documents or notes yet)";
  return sections
    .map((s) => {
      const size = s.body ? `~${Math.max(1, Math.round(estimateTokens(s.body) / 1000))}k tokens` : s.note ?? "no text";
      return `- ${s.header.replace(/^--- /, "").replace(/ ---$/, "")} [${size}]`;
    })
    .join("\n");
}

function excerptHeader(section: CourseSection, partial: boolean): string {
  return partial ? section.header.replace(/ ---$/, " — excerpt ---") : section.header;
}

// What the model sees of a course this turn: the whole thing if it's small,
// otherwise an outline of every document/note plus the passages most relevant
// to `query` (and any document/note the query names, whole). Pure — no I/O.
export function selectCourseContext(sections: CourseSection[], query: string): string {
  const total = sections.reduce((sum, s) => sum + (s.body ? estimateTokens(s.body) : 0), 0);
  if (total <= SMALL_COURSE_TOKENS) {
    return sections.map((s) => (s.body ? `${s.header}\n${s.body}` : s.header)).join("\n\n");
  }

  const parts: string[] = [
    `Course contents — you can see only this outline and the excerpts below, not the full text of every item:\n${outline(sections)}`,
  ];

  const queryTerms = tokenize(query);
  const named = namedSections(sections, query);
  const passages = buildPassages(sections);
  const scores = queryTerms.length > 0 ? scorePassages(passages, queryTerms) : passages.map(() => 0);

  // Whole named items first.
  const included = new Map<number, Set<number>>();
  let budget = EXCERPT_BUDGET_TOKENS;
  const wholeSections: string[] = [];
  for (const i of named) {
    const body = sections[i].body;
    if (!body || estimateTokens(body) > NAMED_SECTION_MAX_TOKENS) continue;
    wholeSections.push(`${sections[i].header}\n${body}`);
    included.set(i, new Set(passages.filter((p) => p.section === i).map((p) => p.index)));
    budget -= estimateTokens(body);
  }

  const best = Math.max(0, ...scores);
  const ranked = passages
    .map((p, i) => ({ p, score: scores[i] }))
    .filter(({ p, score }) => score > 0 && score >= best * RELATIVE_SCORE_CUTOFF && !included.get(p.section)?.has(p.index))
    .sort((a, b) => b.score - a.score);

  const picked: Passage[] = [];
  for (const { p } of ranked) {
    if (picked.length >= MAX_EXCERPTS) break;
    const cost = estimateTokens(p.text);
    if (cost > budget && picked.length > 0) continue;
    picked.push(p);
    budget -= cost;
  }
  // Back in reading order, grouped by item.
  picked.sort((a, b) => a.section - b.section || a.index - b.index);

  const excerpts: string[] = [];
  let currentSection = -1;
  for (const p of picked) {
    if (p.section !== currentSection) {
      excerpts.push(excerptHeader(sections[p.section], true));
      currentSection = p.section;
    }
    excerpts.push(p.text);
  }

  if (wholeSections.length > 0) parts.push(wholeSections.join("\n\n"));
  if (excerpts.length > 0) {
    parts.push(`Excerpts most relevant to the user's latest message:\n${excerpts.join("\n\n")}`);
  } else if (wholeSections.length === 0) {
    parts.push("(No part of the course matched the user's latest message, so no excerpts are included.)");
  }
  return parts.join("\n\n");
}
