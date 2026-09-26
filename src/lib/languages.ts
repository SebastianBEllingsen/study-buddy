// The app-wide "preferred language" setting (app_settings.preferred_language)
// — what AI-written study plans are written in, and which language learning
// resources are preferred in. Kept free of DB imports (same reasoning as
// aiBackendChoices.ts) so the settings dialog can import this list directly.

export interface LanguageOption {
  // BCP-47 primary tag.
  code: string;
  englishName: string;
  nativeName: string;
}

export const DEFAULT_LANGUAGE = "en";

export const LANGUAGES: LanguageOption[] = [
  { code: "en", englishName: "English", nativeName: "English" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية" },
  { code: "zh", englishName: "Chinese", nativeName: "中文" },
  { code: "cs", englishName: "Czech", nativeName: "Čeština" },
  { code: "da", englishName: "Danish", nativeName: "Dansk" },
  { code: "nl", englishName: "Dutch", nativeName: "Nederlands" },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi" },
  { code: "fr", englishName: "French", nativeName: "Français" },
  { code: "de", englishName: "German", nativeName: "Deutsch" },
  { code: "el", englishName: "Greek", nativeName: "Ελληνικά" },
  { code: "he", englishName: "Hebrew", nativeName: "עברית" },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी" },
  { code: "hu", englishName: "Hungarian", nativeName: "Magyar" },
  { code: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "is", englishName: "Icelandic", nativeName: "Íslenska" },
  { code: "it", englishName: "Italian", nativeName: "Italiano" },
  { code: "ja", englishName: "Japanese", nativeName: "日本語" },
  { code: "ko", englishName: "Korean", nativeName: "한국어" },
  { code: "no", englishName: "Norwegian", nativeName: "Norsk" },
  { code: "pl", englishName: "Polish", nativeName: "Polski" },
  { code: "pt", englishName: "Portuguese", nativeName: "Português" },
  { code: "ro", englishName: "Romanian", nativeName: "Română" },
  { code: "ru", englishName: "Russian", nativeName: "Русский" },
  { code: "es", englishName: "Spanish", nativeName: "Español" },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska" },
  { code: "th", englishName: "Thai", nativeName: "ไทย" },
  { code: "tr", englishName: "Turkish", nativeName: "Türkçe" },
  { code: "uk", englishName: "Ukrainian", nativeName: "Українська" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Tiếng Việt" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function isSupportedLanguage(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value);
}

// Anything unrecognized (null, a stale code, garbage) falls back to English.
export function normalizeLanguage(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_LANGUAGE;
  const code = value.trim().toLowerCase();
  return BY_CODE.has(code) ? code : DEFAULT_LANGUAGE;
}

// The English name, for prompts ("Write in Norwegian") — models follow an
// English language name more reliably than a bare code.
export function languageName(code: string): string {
  return BY_CODE.get(normalizeLanguage(code))?.englishName ?? "English";
}
