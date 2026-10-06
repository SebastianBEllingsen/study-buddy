// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLatest } from "./useLatest";

describe("useLatest", () => {
  it("starts with the first value and follows every re-render", () => {
    const { result, rerender } = renderHook(({ value }) => useLatest(value), { initialProps: { value: "a" } });
    expect(result.current.current).toBe("a");
    rerender({ value: "b" });
    expect(result.current.current).toBe("b");
  });

  it("keeps the same ref object, so a callback created once always sees the newest value", () => {
    const { result, rerender } = renderHook(({ value }) => useLatest(value), { initialProps: { value: 1 } });
    const ref = result.current;
    const read = () => ref.current;
    rerender({ value: 2 });
    rerender({ value: 3 });
    expect(result.current).toBe(ref);
    expect(read()).toBe(3);
  });
});
