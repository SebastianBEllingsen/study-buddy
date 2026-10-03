import { describe, expect, it } from "vitest";
import { calculationCardIndices, looksLikeCalculation } from "./calculationCards";

const card = (front: string) => ({ front });

describe("looksLikeCalculation", () => {
  it("flags calculation tasks", () => {
    for (const front of [
      "Compute the Fourier transform of $e^{-t}u(t)$",
      "Calculate the derivative of x^2",
      "<div>Solve $2x + 3 = 7$</div>",
      "Find the derivative of $\\sin x$",
      "Evaluate the integral of 1/x from 1 to e",
      "12 / 4 = ?",
    ]) {
      expect(looksLikeCalculation(card(front)), front).toBe(true);
    }
  });

  it("keeps conceptual cards", () => {
    for (const front of [
      "What does a Fourier transform do?",
      "What is the formula for the derivative of $x^n$?",
      "Why does the integral of 1/x give a logarithm?",
      "When would you use a Laplace transform instead of a Fourier transform?",
      "Define eigenvalue.",
    ]) {
      expect(looksLikeCalculation(card(front)), front).toBe(false);
    }
  });

  it("returns the indices of flagged cards", () => {
    expect(calculationCardIndices([card("Define entropy."), card("Solve x + 1 = 2"), card("Compute 3 + 4")])).toEqual([1, 2]);
  });
});
