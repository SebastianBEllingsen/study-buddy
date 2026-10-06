import type { CardMedia, Flashcard } from "./types";

export interface CardFaceContent {
  text: string;
  media: CardMedia[];
}

// What each side of a flashcard shows. Regular: the front, then the back
// (which, like Anki's {{FrontSide}}, replays the front's media beside its
// own). Reverse: the back's text first — without any video, which would give
// the sign away — then the front with everything.
export function cardFaces(card: Flashcard, reverse: boolean): { prompt: CardFaceContent; answer: CardFaceContent } {
  const front = card.frontMedia ?? [];
  const back = card.backMedia ?? [];
  if (!reverse) {
    return {
      prompt: { text: card.front, media: front },
      answer: { text: card.back, media: [...front, ...back] },
    };
  }
  return {
    prompt: { text: card.back, media: back.filter((m) => m.type !== "video") },
    answer: { text: card.front, media: [...front, ...back.filter((m) => m.type === "video")] },
  };
}
