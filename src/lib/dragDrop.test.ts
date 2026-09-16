import { describe, it, expect } from "vitest";
import { setDragPayload, readDragPayload, type DragPayload } from "./dragDrop";

// setDragPayload/readDragPayload only ever touch e.dataTransfer, so a
// minimal fake stands in for a real React.DragEvent — no jsdom needed.
function fakeEvent() {
  const store: Record<string, string> = {};
  return {
    dataTransfer: {
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? "",
      effectAllowed: undefined as string | undefined,
    },
  } as unknown as React.DragEvent;
}

describe("setDragPayload / readDragPayload round-trip", () => {
  it("round-trips a document payload", () => {
    const e = fakeEvent();
    const payload: DragPayload = { kind: "document", id: 42 };
    setDragPayload(e, payload);
    expect(readDragPayload(e)).toEqual(payload);
  });

  it("round-trips every payload kind", () => {
    const payloads: DragPayload[] = [
      { kind: "document", id: 1 },
      { kind: "item", id: 2 },
      { kind: "note", id: 3 },
      { kind: "folder", id: 4 },
      { kind: "course", id: 5 },
      { kind: "widget", id: "streak" },
    ];
    for (const payload of payloads) {
      const e = fakeEvent();
      setDragPayload(e, payload);
      expect(readDragPayload(e)).toEqual(payload);
    }
  });

  it("sets effectAllowed to 'move'", () => {
    const e = fakeEvent();
    setDragPayload(e, { kind: "course", id: 1 });
    expect(e.dataTransfer.effectAllowed).toBe("move");
  });

  it("returns null when no payload was set", () => {
    const e = fakeEvent();
    expect(readDragPayload(e)).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const e = fakeEvent();
    e.dataTransfer.setData("application/x-studybuddy-drag", "{not valid json");
    expect(readDragPayload(e)).toBeNull();
  });

  it("doesn't read a payload set under a different MIME type", () => {
    const e = fakeEvent();
    e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "course", id: 1 }));
    expect(readDragPayload(e)).toBeNull();
  });
});
