// @vitest-environment jsdom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const swr = vi.fn();
vi.mock("swr", () => ({ default: (...args: unknown[]) => swr(...args) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { StorageFallbackBanner } = await import("./StorageFallbackBanner");

const mutate = vi.fn();
const show = (data: { connectionError: string | null } | undefined) => swr.mockReturnValue({ data, mutate });

beforeEach(() => {
  swr.mockReset();
  mutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StorageFallbackBanner", () => {
  it("shows nothing while the database is reachable, or before we know", () => {
    show({ connectionError: null });
    const { container, rerender } = render(createElement(StorageFallbackBanner));
    expect(container.innerHTML).toBe("");
    show(undefined);
    rerender(createElement(StorageFallbackBanner));
    expect(container.innerHTML).toBe("");
  });

  it("says plainly that you're on the local copy, with the reason", () => {
    show({ connectionError: "connect ECONNREFUSED 10.0.0.1:5432" });
    render(createElement(StorageFallbackBanner));
    expect(screen.getByRole("alert").textContent).toContain("Can't reach your cloud database");
    expect(screen.getByRole("alert").textContent).toContain("stays here");
    expect(screen.getByText("connect ECONNREFUSED 10.0.0.1:5432")).toBeTruthy();
  });

  it("checks again every 30 seconds while it's down, and not otherwise", () => {
    show({ connectionError: "down" });
    render(createElement(StorageFallbackBanner));
    const options = swr.mock.calls[0][1] as { refreshInterval: (latest?: { connectionError: string | null }) => number };
    expect(options.refreshInterval({ connectionError: "down" })).toBe(30_000);
    expect(options.refreshInterval({ connectionError: null })).toBe(0);
    expect(options.refreshInterval(undefined)).toBe(0);
  });

  it("tries again on request and reloads once it's back", async () => {
    show({ connectionError: "down" });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, error: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(StorageFallbackBanner));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/storage-settings/reconnect", { method: "POST" });
    expect(toast.success).toHaveBeenCalled();
  });

  it("says so when it still can't connect, and stays put", async () => {
    show({ connectionError: "down" });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: "still down" }) }));
    render(createElement(StorageFallbackBanner));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Still can't reach it"));
    expect(reload).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalled();
  });
});
