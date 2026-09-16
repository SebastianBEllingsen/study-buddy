// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const useSWR = vi.fn();
vi.mock("swr", () => ({ default: useSWR }));

const { useAiEnabled } = await import("./useAiEnabled");

describe("useAiEnabled", () => {
  it("defaults to true before the settings have loaded", () => {
    useSWR.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useAiEnabled());
    expect(result.current).toBe(true);
  });

  it("returns the persisted aiEnabled value once loaded", () => {
    useSWR.mockReturnValue({ data: { aiEnabled: false } });
    const { result } = renderHook(() => useAiEnabled());
    expect(result.current).toBe(false);
  });

  it("reads from the shared /api/settings SWR cache key", () => {
    useSWR.mockReturnValue({ data: undefined });
    renderHook(() => useAiEnabled());
    expect(useSWR).toHaveBeenCalledWith("/api/settings");
  });
});
