import { describe, expect, it } from "vitest";
import {
  abs2, add, cadd, ceq, cmul, conj, cx, div, eq, frac, fracToLatex, fracToString, gaussianToLatex, mul, neg, parseFraction,
  parseGaussian, pow, sub, toNumber,
} from "./fraction";
import { antiderivative, derivative, evaluate, parsePoly, poly, polyEq, polyToLatex } from "./poly";

const f = frac;

describe("fractions", () => {
  it("reduce and keep the sign on the top", () => {
    expect(f(6, 8)).toEqual({ n: 3, d: 4 });
    expect(f(3, -6)).toEqual({ n: -1, d: 2 });
    expect(f(0, -5)).toEqual({ n: 0, d: 1 });
    expect(() => f(1, 0)).toThrow();
  });

  it("do arithmetic exactly", () => {
    expect(add(f(1, 3), f(1, 6))).toEqual(f(1, 2));
    expect(sub(f(1, 2), f(3, 4))).toEqual(f(-1, 4));
    expect(mul(f(2, 3), f(-3, 4))).toEqual(f(-1, 2));
    expect(div(f(1, 2), f(3, 4))).toEqual(f(2, 3));
    expect(eq(neg(f(1, 2)), f(-2, 4))).toBe(true);
    expect(pow(f(2, 3), 3)).toEqual(f(8, 27));
    expect(toNumber(f(1, 4))).toBe(0.25);
    // 0.1 + 0.2 really is 0.3 here.
    expect(eq(add(f(1, 10), f(2, 10)), f(3, 10))).toBe(true);
  });

  it("write themselves as text and LaTeX", () => {
    expect(fracToString(f(3, 4))).toBe("3/4");
    expect(fracToString(f(4, 2))).toBe("2");
    expect(fracToLatex(f(-3, 4))).toBe("-\\frac{3}{4}");
    expect(fracToLatex(f(5))).toBe("5");
  });
});

describe("parseFraction", () => {
  it("reads the forms a student types", () => {
    expect(parseFraction("3/4")).toEqual(f(3, 4));
    expect(parseFraction(" -3 / 4 ")).toEqual(f(-3, 4));
    expect(parseFraction("−1/2")).toEqual(f(-1, 2));
    expect(parseFraction("6/8")).toEqual(f(3, 4));
    expect(parseFraction("7")).toEqual(f(7));
    expect(parseFraction("+7")).toEqual(f(7));
    expect(parseFraction("0.75")).toEqual(f(3, 4));
    expect(parseFraction("-0.5")).toEqual(f(-1, 2));
    expect(parseFraction(".5")).toEqual(f(1, 2));
    expect(parseFraction("3.")).toEqual(f(3));
    // A decimal is exact: 0.333 is not a third.
    expect(parseFraction("0.333")).toEqual(f(333, 1000));
  });

  it("refuses everything else", () => {
    for (const bad of ["", " ", "abc", "1/0", "1/2/3", "--1", "1.2.3", "1/", "/2", ".", "-", "1e3", "0.1234567891", "3/4x", "1 2"]) {
      expect(parseFraction(bad), bad).toBeNull();
    }
  });
});

describe("Gaussian rationals", () => {
  it("multiply, conjugate and measure like complex numbers", () => {
    const a = cx(f(1), f(2)), b = cx(f(3), f(-1));
    expect(cmul(a, b)).toEqual(cx(f(5), f(5))); // (1+2i)(3−i) = 3 − i + 6i + 2 = 5 + 5i
    expect(conj(a)).toEqual(cx(f(1), f(-2)));
    expect(abs2(a)).toEqual(f(5));
    expect(ceq(cadd(a, b), cx(f(4), f(1)))).toBe(true);
    expect(cmul(cx(f(0), f(1)), cx(f(0), f(1)))).toEqual(cx(f(-1), f(0)));
  });

  it("read the forms a student types", () => {
    expect(parseGaussian("3+4i")).toEqual(cx(f(3), f(4)));
    expect(parseGaussian("3 - 4i")).toEqual(cx(f(3), f(-4)));
    expect(parseGaussian("i")).toEqual(cx(f(0), f(1)));
    expect(parseGaussian("-i")).toEqual(cx(f(0), f(-1)));
    expect(parseGaussian("2")).toEqual(cx(f(2), f(0)));
    expect(parseGaussian("1/2 - 3/4i")).toEqual(cx(f(1, 2), f(-3, 4)));
    expect(parseGaussian("4i+1")).toEqual(cx(f(1), f(4)));
    expect(parseGaussian("2*i")).toEqual(cx(f(0), f(2)));
    expect(parseGaussian("1+2i+3")).toEqual(cx(f(4), f(2)));
    expect(parseGaussian("−2i")).toEqual(cx(f(0), f(-2)));
  });

  it("refuse what isn't one", () => {
    for (const bad of ["", "x", "3+", "i2", "3+4j", "1/0i", "++1", "2 3"]) expect(parseGaussian(bad), bad).toBeNull();
  });

  it("write themselves as LaTeX", () => {
    expect(gaussianToLatex(cx(f(3), f(4)))).toBe("3 + 4i");
    expect(gaussianToLatex(cx(f(3), f(-1)))).toBe("3 - i");
    expect(gaussianToLatex(cx(f(0), f(-2)))).toBe("-2i");
    expect(gaussianToLatex(cx(f(1, 2), f(3, 4)))).toBe("\\frac{1}{2} + \\frac{3}{4}i");
    expect(gaussianToLatex(cx(f(5), f(0)))).toBe("5");
  });
});

describe("polynomials", () => {
  it("differentiate and integrate", () => {
    const p = poly([[3, 2], [2, -3], [0, 5]]); // 2x³ − 3x² + 5
    expect(polyEq(derivative(p), poly([[2, 6], [1, -6]]))).toBe(true);
    expect(polyEq(antiderivative(poly([[2, 3], [1, 2]])), poly([[3, 1], [2, 1]]))).toBe(true);
    expect(derivative(poly([[0, 7]])).size).toBe(0);
    expect(evaluate(p, f(2))).toEqual(f(9)); // 16 − 12 + 5
    expect(evaluate(poly([[1, 1]]), f(1, 2))).toEqual(f(1, 2));
  });

  it("read the forms a student types", () => {
    const expected = poly([[2, 3], [1, -4], [0, 1]]);
    for (const text of ["3x^2 - 4x + 1", "3*x**2-4*x+1", "3x²−4x+1", "1 - 4x + 3x^2", "x^2*3 - 4x + 1".replace("x^2*3", "3x^2")]) {
      expect(polyEq(parsePoly(text) as never, expected), text).toBe(true);
    }
    expect(polyEq(parsePoly("-x") as never, poly([[1, -1]]))).toBe(true);
    expect(polyEq(parsePoly("(1/2)x^2") as never, poly([[2, f(1, 2)]]))).toBe(true);
    expect(polyEq(parsePoly("1/2x^2") as never, poly([[2, f(1, 2)]]))).toBe(true);
    expect(polyEq(parsePoly("x+x") as never, poly([[1, 2]]))).toBe(true);
    expect(polyEq(parsePoly("x-x") as never, poly([]))).toBe(true);
    expect(polyEq(parsePoly("7") as never, poly([[0, 7]]))).toBe(true);
  });

  it("refuse what isn't one", () => {
    for (const bad of ["", "y", "3x^", "x^-1", "sin(x)", "3x^2 +", "x^99", "2^x", "x y"]) expect(parsePoly(bad), bad).toBeNull();
  });

  it("write themselves as LaTeX, highest degree first", () => {
    expect(polyToLatex(poly([[2, 3], [1, -4], [0, 1]]))).toBe("3x^{2} - 4x + 1");
    expect(polyToLatex(poly([[1, -1], [0, 2]]))).toBe("-x + 2");
    expect(polyToLatex(poly([[3, f(1, 3)]]))).toBe("\\frac{1}{3}x^{3}");
    expect(polyToLatex(poly([]))).toBe("0");
  });
});
