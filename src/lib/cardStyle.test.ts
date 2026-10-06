import { describe, it, expect } from "vitest";
import { isCardStyle, parseCardStyle } from "./cardStyle";

describe("card style", () => {
  it("defaults to transparent, including for an unset or unknown stored value", () => {
    expect(parseCardStyle(null)).toBe("transparent");
    expect(parseCardStyle(undefined)).toBe("transparent");
    expect(parseCardStyle("glass")).toBe("transparent");
  });

  it("reads the boxed style back", () => {
    expect(parseCardStyle("boxed")).toBe("boxed");
  });

  it("only accepts the two styles", () => {
    expect(isCardStyle("boxed")).toBe(true);
    expect(isCardStyle("transparent")).toBe(true);
    expect(isCardStyle("classic")).toBe(false);
  });
});
