import { describe, expect, it } from "vitest";
import { cardFaces } from "./cardFaces";
import type { Flashcard } from "./types";

const video = { type: "video" as const, src: "/media/sign.mp4" };
const audio = { type: "audio" as const, src: "/media/word.mp3" };
const card: Flashcard = { front: "sign", back: "hus", frontMedia: [video], backMedia: [audio] };

describe("cardFaces", () => {
  it("shows the front first, and the back beside the front's media", () => {
    const { prompt, answer } = cardFaces(card, false);
    expect(prompt).toEqual({ text: "sign", media: [video] });
    expect(answer).toEqual({ text: "hus", media: [video, audio] });
  });

  it("reverse asks with the back's text and hides the video", () => {
    const { prompt, answer } = cardFaces(card, true);
    expect(prompt).toEqual({ text: "hus", media: [audio] });
    expect(answer).toEqual({ text: "sign", media: [video] });
  });

  it("never shows a video from the back before the reveal", () => {
    const other = { type: "video" as const, src: "/media/other.mp4" };
    const { prompt, answer } = cardFaces({ ...card, backMedia: [other] }, true);
    expect(prompt.media).toEqual([]);
    expect(answer.media).toEqual([video, other]);
  });
});
