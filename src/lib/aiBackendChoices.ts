import type { AiBackend } from "./models";

// claude_code and codex_cli shell out to a one-shot CLI subprocess with no
// way to attach image bytes (see aiBackends/claudeCode.ts, codexCli.ts) —
// the only 4 backends that can actually take image input, so the only ones
// offered for image_ai_provider (see AppSettings.imageAiBackend in
// lib/models.ts). Kept out of models.ts (same reasoning as
// lib/fontChoices.ts) so a client component can import this plain array
// without dragging in models.ts's DB layer (better-sqlite3 et al. don't
// bundle for the browser).
export const IMAGE_CAPABLE_BACKENDS: AiBackend[] = ["api", "openai", "gemini", "free"];
