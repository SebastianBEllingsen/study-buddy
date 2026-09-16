import { describe, it, expect } from "vitest";
import { renderQuizHtml } from "./quizExport";
import type { QuizContent } from "./types";

describe("renderQuizHtml", () => {
  it("escapes HTML-significant characters in the title", () => {
    const html = renderQuizHtml('<script>alert("x")</script>', { questions: [] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("escapes HTML-significant characters in question/option/explanation text", () => {
    const content: QuizContent = {
      questions: [
        {
          type: "mcq",
          question: 'What is <b>2</b> & "3"?',
          options: ["<img src=x>", "O'Brien's answer"],
          correctIndex: 0,
          explanation: "Because & reasons",
        },
      ],
    };
    const html = renderQuizHtml("Quiz", content);
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("O&#39;Brien&#39;s answer");
    expect(html).toContain("What is &lt;b&gt;2&lt;/b&gt; &amp; &quot;3&quot;?");
    expect(html).toContain("Because &amp; reasons");
  });

  it("marks the correct option for an mcq question", () => {
    const content: QuizContent = {
      questions: [
        { type: "mcq", question: "Q", options: ["a", "b", "c"], correctIndex: 1, explanation: "E" },
      ],
    };
    const html = renderQuizHtml("Quiz", content);
    expect(html).toMatch(/<li class="correct">b<\/li>/);
    expect(html).toMatch(/<li class="">a<\/li>/);
    expect(html).toMatch(/<li class="">c<\/li>/);
  });

  it("marks every correct option for a multi_select question", () => {
    const content: QuizContent = {
      questions: [
        {
          type: "multi_select",
          question: "Q",
          options: ["a", "b", "c"],
          correctIndices: [0, 2],
          explanation: "E",
        },
      ],
    };
    const html = renderQuizHtml("Quiz", content);
    expect(html).toMatch(/<li class="correct">a<\/li>/);
    expect(html).toMatch(/<li class="">b<\/li>/);
    expect(html).toMatch(/<li class="correct">c<\/li>/);
    expect(html).toContain("Select all that apply.");
  });

  it("renders the model answer for a short_answer question", () => {
    const content: QuizContent = {
      questions: [
        { type: "short_answer", question: "Q", modelAnswer: "42", explanation: "E" },
      ],
    };
    const html = renderQuizHtml("Quiz", content);
    expect(html).toContain("<strong>Model answer:</strong> 42");
  });

  it("numbers questions starting from 1", () => {
    const content: QuizContent = {
      questions: [
        { type: "short_answer", question: "First", modelAnswer: "a", explanation: "e" },
        { type: "short_answer", question: "Second", modelAnswer: "b", explanation: "e" },
      ],
    };
    const html = renderQuizHtml("Quiz", content);
    expect(html).toContain("1. First");
    expect(html).toContain("2. Second");
  });

  it("renders valid-looking HTML document structure", () => {
    const html = renderQuizHtml("Quiz", { questions: [] });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<title>Quiz</title>");
    expect(html).toContain("<h1>Quiz</h1>");
  });
});
