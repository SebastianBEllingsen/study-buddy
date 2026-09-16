import { describe, it, expect, vi, afterEach } from "vitest";
import { isRetryableStatus, withRetry } from "./retry";

describe("isRetryableStatus", () => {
  it("accepts every declared retryable status code", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it("rejects a non-retryable status code", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });

  it("rejects non-number values without throwing", () => {
    expect(isRetryableStatus("429")).toBe(false);
    expect(isRetryableStatus(undefined)).toBe(false);
    expect(isRetryableStatus(null)).toBe(false);
    expect(isRetryableStatus({})).toBe(false);
  });
});

describe("withRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, () => true);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure and eventually succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValueOnce("ok");
    const promise = withRetry(fn, () => true, 3, 10);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when isRetryable returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(withRetry(fn, () => false, 3, 10)).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error after exhausting all attempts", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const promise = withRetry(fn, () => true, 3, 10);
    const assertion = expect(promise).rejects.toThrow("always fails");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("waits with exponential backoff between attempts", async () => {
    // Regression coverage: an earlier version of this test only ever
    // triggered one retry, so the only observable delay was
    // baseDelayMs * 2**0 — indistinguishable from a constant (non-
    // exponential) backoff at that exact value. Forcing two retries here
    // pins down the actual doubling sequence.
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValueOnce("ok");
    const promise = withRetry(fn, () => true, 3, 100);
    await vi.runAllTimersAsync();
    await promise;
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
    // baseDelayMs * 2**0, then baseDelayMs * 2**1 — a constant (non-
    // doubling) backoff would produce [100, 100] instead.
    expect(delays).toEqual([100, 200]);
  });
});
