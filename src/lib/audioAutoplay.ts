// What a flashcard face does with its audio clips when it's shown — imported
// decks often pair a word with an example sentence. "first" autoplays only
// the first clip (the rest wait for their play button); "sequence" plays
// them one after another, like Anki.
export const AUDIO_AUTOPLAY_MODES = ["first", "sequence"] as const;
export type AudioAutoplayMode = (typeof AUDIO_AUTOPLAY_MODES)[number];

export const AUDIO_AUTOPLAY_LABELS: Record<AudioAutoplayMode, string> = {
  first: "First clip only",
  sequence: "One after another",
};

export function isAudioAutoplayMode(value: unknown): value is AudioAutoplayMode {
  return (AUDIO_AUTOPLAY_MODES as readonly unknown[]).includes(value);
}

// Stored as null for the default, like the other text settings.
export function parseAudioAutoplayMode(value: string | null | undefined): AudioAutoplayMode {
  return value === "sequence" ? "sequence" : "first";
}
