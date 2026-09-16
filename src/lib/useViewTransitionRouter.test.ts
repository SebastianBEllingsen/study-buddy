// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { useViewTransitionRouter } = await import("./useViewTransitionRouter");

afterEach(() => {
  push.mockReset();
  vi.unstubAllGlobals();
  // @ts-expect-error -- test-only cleanup of a jsdom global this suite stubs
  delete document.startViewTransition;
});

describe("useViewTransitionRouter", () => {
  it("falls back to a plain router.push when startViewTransition isn't supported", () => {
    const { result } = renderHook(() => useViewTransitionRouter());
    act(() => {
      result.current.push("/somewhere");
    });
    expect(push).toHaveBeenCalledWith("/somewhere");
  });

  it("wraps the navigation in document.startViewTransition when supported", () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    });
    // @ts-expect-error -- stubbing a browser API jsdom doesn't implement
    document.startViewTransition = startViewTransition;

    const { result } = renderHook(() => useViewTransitionRouter());
    act(() => {
      result.current.push("/somewhere");
    });
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/somewhere");
  });

  it("swallows a rejected ready/finished promise instead of throwing an unhandled rejection", async () => {
    // Regression coverage: an earlier version of this test awaited
    // `readyRejection.catch(() => "handled")` — i.e. it attached its OWN
    // handler to the same promise object the hook is supposed to handle.
    // Since a promise only counts as "unhandled" when it has zero handlers
    // by the time the microtask queue drains, that assertion would resolve
    // exactly the same way whether or not the hook's own push() ever
    // touched transition.ready/finished at all — it proved nothing about
    // the hook's behavior. This instead listens for Node's real
    // 'unhandledRejection' event, which only fires when a rejected promise
    // truly has no handler anywhere.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const readyRejection = Promise.reject(new Error("transition skipped"));
    const finishedRejection = Promise.reject(new Error("transition skipped"));
    // @ts-expect-error -- stubbing a browser API jsdom doesn't implement
    document.startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { ready: readyRejection, finished: finishedRejection };
    });

    try {
      const { result } = renderHook(() => useViewTransitionRouter());
      act(() => {
        result.current.push("/somewhere");
      });
      // Let the microtask queue (and Node's unhandled-rejection check,
      // which runs after it) fully drain before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
