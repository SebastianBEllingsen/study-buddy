import { describe, expect, it } from "vitest";
import { isSkillCheckProfile, SKILL_CHECK_MINUTES, topicProfile } from "./topicProfile";

describe("topicProfile", () => {
  it("weights study plan chapters by their estimated time", () => {
    const profile = topicProfile({
      chapters: [
        { title: "Basics", estimated_minutes: 60 },
        { title: "Functions", estimated_minutes: 180 },
        { title: "Unestimated", estimated_minutes: null },
      ],
      concepts: ["Ignored"],
      hasMaterial: false,
      language: "English",
    })!;
    expect(profile.topics).toEqual([
      { concept: "Functions", share: 0.6 },
      { concept: "Basics", share: 0.2 },
      { concept: "Unestimated", share: 0.2 },
    ]);
    expect(profile).toMatchObject({ durationMinutes: SKILL_CHECK_MINUTES, totalPoints: 100, language: "English" });
    expect(isSkillCheckProfile(profile)).toBe(true);
  });

  it("spreads evenly over concepts without a plan, and leaves topics to the material otherwise", () => {
    expect(topicProfile({ chapters: [], concepts: ["A", "B"], hasMaterial: false, language: "English" })!.topics).toEqual([
      { concept: "A", share: 0.5 },
      { concept: "B", share: 0.5 },
    ]);
    expect(topicProfile({ chapters: [], concepts: [], hasMaterial: true, language: "English" })!.topics).toEqual([]);
    expect(topicProfile({ chapters: [], concepts: [], hasMaterial: false, language: "English" })).toBeNull();
  });
});
