import { describe, it, expect } from "vitest";
import {
  stripOrphanMathDelimiters,
  sanitizeNotesContent,
  sanitizeQuizContent,
  sanitizeFlashcardsContent,
  normalizeLatexDelimiters,
  MATH_PATTERN,
} from "./mathSanitizer";
import { InvalidAiResponseError } from "./aiResponseValidation";
import type { QuizContent, FlashcardsContent } from "./types";

describe("stripOrphanMathDelimiters", () => {
  it("leaves a legitimate inline math span byte-for-byte untouched", () => {
    const input = "The formula is $E=mc^2$ approximately.";
    expect(stripOrphanMathDelimiters(input)).toBe(input);
  });

  it("leaves a legitimate block math span byte-for-byte untouched", () => {
    const input = "Consider:\n\n$$\\int_0^1 x^2 dx$$\n\nDone.";
    expect(stripOrphanMathDelimiters(input)).toBe(input);
  });

  it("strips delimiters (keeping the text) around content containing a colon", () => {
    // The known generation-merge bug: two "Label: <formula>" lines bridged
    // by MATH_PATTERN's lazy match into one fake pair. The colon heuristic
    // rejects it as real math without even attempting to parse it.
    expect(stripOrphanMathDelimiters("Label: $x: y$ rest")).toBe("Label: x: y rest");
  });

  it("strips delimiters around content that fails to parse as LaTeX", () => {
    expect(stripOrphanMathDelimiters("See $\\frac{1$ end")).toBe("See \\frac{1 end");
  });

  it("strips a stray single delimiter with no matching partner", () => {
    expect(stripOrphanMathDelimiters("Cost is $5 total")).toBe("Cost is 5 total");
  });

  it("strips stray double delimiters with no matching partner", () => {
    expect(stripOrphanMathDelimiters("Total: $$ due")).toBe("Total:  due");
  });

  it("handles text with no delimiters at all", () => {
    expect(stripOrphanMathDelimiters("Nothing mathy here.")).toBe("Nothing mathy here.");
  });

  it("handles an empty string", () => {
    expect(stripOrphanMathDelimiters("")).toBe("");
  });
});

describe("normalizeLatexDelimiters", () => {
  it("converts MathJax-style inline delimiters to $...$", () => {
    expect(normalizeLatexDelimiters("The formula is \\(E=mc^2\\) approximately.")).toBe(
      "The formula is $E=mc^2$ approximately."
    );
  });

  it("converts MathJax-style display delimiters to $$...$$", () => {
    expect(normalizeLatexDelimiters("Consider:\n\n\\[\\int_0^1 x^2 dx\\]\n\nDone.")).toBe(
      "Consider:\n\n$$\\int_0^1 x^2 dx$$\n\nDone."
    );
  });

  it("leaves text with no MathJax delimiters untouched", () => {
    const input = "The formula is $E=mc^2$ already.";
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it("handles multiple inline spans in the same string", () => {
    expect(normalizeLatexDelimiters("\\(p\\) implies \\(q\\)")).toBe("$p$ implies $q$");
  });
});

describe("MATH_PATTERN (MathJax delimiter support)", () => {
  it("matches a \\(...\\) inline span, capturing it in the 4th group", () => {
    const match = "See \\(x+1\\) here".match(MATH_PATTERN);
    expect(match).toEqual(["\\(x+1\\)"]);
  });

  it("matches a \\[...\\] display span, capturing it in the 3rd group", () => {
    const match = "\\[x+1\\]".match(MATH_PATTERN);
    expect(match).toEqual(["\\[x+1\\]"]);
  });
});

describe("sanitizeNotesContent", () => {
  it("sanitizes the markdown field", () => {
    expect(sanitizeNotesContent({ markdown: "Cost is $5 total" })).toEqual({
      markdown: "Cost is 5 total",
    });
  });
});

describe("sanitizeQuizContent", () => {
  it("sanitizes question/explanation/options for an mcq question", () => {
    const content: QuizContent = {
      questions: [
        {
          type: "mcq",
          question: "Price is $5$ today?",
          explanation: "See $5: 5$ notes",
          options: ["Cost: $5$", "Note: $x: y$"],
          correctIndex: 0,
        },
      ],
    };
    const result = sanitizeQuizContent(content);
    const q = result.questions[0];
    expect(q.question).toBe("Price is $5$ today?");
    expect(q.explanation).toBe("See 5: 5 notes");
    if (q.type === "mcq") {
      expect(q.options).toEqual(["Cost: $5$", "Note: x: y"]);
    }
  });

  it("sanitizes question/explanation/modelAnswer for a short_answer question", () => {
    const content: QuizContent = {
      questions: [
        { type: "short_answer", question: "What is $5$?", explanation: "E", modelAnswer: "Answer: $5$" },
      ],
    };
    const result = sanitizeQuizContent(content);
    const q = result.questions[0];
    expect(q.question).toBe("What is $5$?");
    if (q.type === "short_answer") {
      expect(q.modelAnswer).toBe("Answer: $5$");
    }
  });

  it("throws InvalidAiResponseError for a malformed shape", () => {
    expect(() => sanitizeQuizContent({} as QuizContent)).toThrow(InvalidAiResponseError);
  });
});

describe("sanitizeFlashcardsContent", () => {
  it("sanitizes front/back text", () => {
    const content: FlashcardsContent = {
      cards: [{ front: "Front: $5$", back: "Cost is $5 total" }],
    };
    expect(sanitizeFlashcardsContent(content)).toEqual({
      cards: [{ front: "Front: $5$", back: "Cost is 5 total" }],
    });
  });

  it("throws InvalidAiResponseError for a malformed shape", () => {
    expect(() => sanitizeFlashcardsContent({} as FlashcardsContent)).toThrow(InvalidAiResponseError);
  });
});
