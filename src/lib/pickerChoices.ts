// Shared emoji/color choices for the various "customize this thing" pickers
// (courses, folders, notes) — kept in their own file, not lib/models.ts
// (server-only, pulls in better-sqlite3), so client components can import
// them as a value without dragging the DB layer into the browser bundle.
// Same reasoning as lib/fontChoices.ts.
export const ICON_CHOICES = [
  "📚", "📖", "✏️", "🧮", "🧪", "🔬", "🧬", "💻",
  "🖥️", "🌐", "⚖️", "🏛️", "🎨", "🎵", "🗣️", "📈",
  "💰", "🧠", "🩺", "⚙️", "🔐", "🚀", "🌍", "📐",
] as const;

// The app's own accent palette (see globals.css) — keeps per-thing color
// picks harmonizing with the rest of the UI rather than clashing with it.
export const COLOR_CHOICES = [
  { label: "Focus", value: "#2F6F68" },
  { label: "Amber", value: "#C98A2C" },
  { label: "Sage", value: "#4B8A63" },
  { label: "Clay", value: "#C1554B" },
] as const;
