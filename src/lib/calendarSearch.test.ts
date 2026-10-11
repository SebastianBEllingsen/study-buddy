import { describe, it, expect } from "vitest";
import { matchesCalendarQuery } from "./calendarSearch";

const event = {
  title: "Essay 2",
  description: "Due Friday, submit online",
  location: "Room 4",
  source: "Course feed",
};

describe("matchesCalendarQuery", () => {
  it("matches case-insensitively on the title", () => {
    expect(matchesCalendarQuery(event, "essay")).toBe(true);
  });

  it("matches on description, location and source", () => {
    expect(matchesCalendarQuery(event, "friday")).toBe(true);
    expect(matchesCalendarQuery(event, "room 4")).toBe(true);
    expect(matchesCalendarQuery(event, "course feed")).toBe(true);
  });

  it("requires every term to match, across fields", () => {
    expect(matchesCalendarQuery(event, "essay friday")).toBe(true);
    expect(matchesCalendarQuery(event, "essay thursday")).toBe(false);
  });

  it("handles missing fields and never matches an empty query", () => {
    expect(matchesCalendarQuery({ title: "Quiz", description: null, location: null }, "quiz")).toBe(true);
    expect(matchesCalendarQuery(event, "   ")).toBe(false);
  });
});
