import { describe, it, expect } from "vitest";
import { applyClick, rangeBetween } from "./rangeSelect";

const ids = [10, 20, 30, 40, 50];

describe("rangeBetween", () => {
  it("covers the rows between the anchor and the target, in either direction", () => {
    expect(rangeBetween(ids, 20, 40)).toEqual([20, 30, 40]);
    expect(rangeBetween(ids, 40, 20)).toEqual([20, 30, 40]);
  });

  it("is just the clicked row without a usable anchor", () => {
    expect(rangeBetween(ids, null, 30)).toEqual([30]);
    expect(rangeBetween(ids, 99, 30)).toEqual([30]);
    expect(rangeBetween(ids, 20, 99)).toEqual([99]);
  });
});

describe("applyClick", () => {
  it("a plain click only changes that row", () => {
    expect([...applyClick(new Set([10]), 30, { checked: true, shift: false, orderedIds: ids, anchor: 10 })]).toEqual([10, 30]);
    expect([...applyClick(new Set([10, 30]), 30, { checked: false, shift: false, orderedIds: ids, anchor: 10 })]).toEqual([10]);
  });

  it("a shift-click selects the whole range and keeps what was already selected", () => {
    const next = applyClick(new Set([50]), 40, { checked: true, shift: true, orderedIds: ids, anchor: 20 });
    expect([...next].sort((a, b) => a - b)).toEqual([20, 30, 40, 50]);
  });

  it("a shift-click on a selected row's range unselects it", () => {
    const next = applyClick(new Set(ids), 40, { checked: false, shift: true, orderedIds: ids, anchor: 20 });
    expect([...next].sort((a, b) => a - b)).toEqual([10, 50]);
  });
});
