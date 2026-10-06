// How a flashcard sits on the page. "transparent" drops the card's own box
// so the content (and the wallpaper behind it) shows through, in a soft
// translucent panel; "boxed" keeps the card as a solid, bordered box.
export const CARD_STYLES = ["transparent", "boxed"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
  transparent: "Transparent",
  boxed: "Boxed",
};

export function isCardStyle(value: unknown): value is CardStyle {
  return (CARD_STYLES as readonly unknown[]).includes(value);
}

// Stored as null for the default, like the other text settings.
export function parseCardStyle(value: string | null | undefined): CardStyle {
  return value === "boxed" ? "boxed" : "transparent";
}
