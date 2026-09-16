// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const useSWR = vi.fn();
vi.mock("swr", () => ({ default: useSWR }));

const { useShowModelBadge } = await import("./useShowModelBadge");

describe("useShowModelBadge", () => {
  it("defaults to shown/detailed before the settings have loaded", () => {
    useSWR.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useShowModelBadge());
    expect(result.current).toEqual({ show: true, detail: "detailed" });
  });

  it("returns the persisted values once loaded", () => {
    useSWR.mockReturnValue({ data: { showModelBadge: false, modelBadgeDetail: "minimal" } });
    const { result } = renderHook(() => useShowModelBadge());
    expect(result.current).toEqual({ show: false, detail: "minimal" });
  });

  it("defaults detail to 'detailed' when unset even though show is loaded", () => {
    useSWR.mockReturnValue({ data: { showModelBadge: true, modelBadgeDetail: null } });
    const { result } = renderHook(() => useShowModelBadge());
    expect(result.current.detail).toBe("detailed");
  });
});
