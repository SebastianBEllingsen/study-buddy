import { useEffect, useRef } from "react";

// The newest value from render, readable from a long-lived callback — a
// document key handler, a timer — without re-registering it on every change.
// Re-registering only when some of the values change (and listing the rest
// as "fine to be stale") is how a handler ends up acting on an old value.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
