// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const useSWR = vi.fn();
vi.mock("swr", () => ({ default: useSWR }));

const { useDocumentBadgeSettings } = await import("./useDocumentBadgeSettings");

describe("useDocumentBadgeSettings", () => {
  it("defaults to enabled/detailed before the settings have loaded", () => {
    useSWR.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useDocumentBadgeSettings());
    expect(result.current).toEqual({ enabled: true, detail: "detailed" });
  });

  it("returns the persisted values once loaded", () => {
    useSWR.mockReturnValue({ data: { documentBadgesEnabled: false, documentBadgeDetail: "minimal" } });
    const { result } = renderHook(() => useDocumentBadgeSettings());
    expect(result.current).toEqual({ enabled: false, detail: "minimal" });
  });
});
