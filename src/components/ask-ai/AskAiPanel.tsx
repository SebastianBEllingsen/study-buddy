"use client";

import { useTextSelection } from "./useTextSelection";
import { useAskAi, type AskKind } from "./useAskAi";
import { AskAiToolbar } from "./AskAiToolbar";
import { AskAiButtons } from "./AskAiButtons";
import { AskAiAnswer } from "./AskAiAnswer";

const DEFAULT_KINDS: AskKind[] = ["hint", "explain"];

/**
 * Drop this below whatever content `containerRef` wraps. Handles: the
 * floating Hint/Explain toolbar that appears when text is selected inside
 * the container, the optional no-selection "whole thing" fallback buttons,
 * and the answer/loading/error display — all backed by one ask-AI call.
 *
 * Safety is by construction, not by prompting: `getWholeContext()` must
 * return only text that's already visibly rendered to the user right now
 * (see src/lib/prompts/ask.ts and the callers of this component).
 */
export function AskAiPanel({
  endpoint,
  containerRef,
  getWholeContext,
  showWholeButtons = false,
  kinds = DEFAULT_KINDS,
}: {
  // The ask route to POST to — e.g. `/api/items/:id/ask` or
  // `/api/courses/:courseId/documents/:documentId/ask`.
  endpoint: string;
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Omit for unbounded content (e.g. notes) where there's no sensible
   * "whole thing" to send — the selection itself becomes the entire
   * context instead of being layered onto a bigger document.
   */
  getWholeContext?: () => string;
  showWholeButtons?: boolean;
  // Which ask kinds are offered — e.g. document viewer selections only
  // offer "explain" (see AskAiToolbar).
  kinds?: AskKind[];
}) {
  const { selection, clear } = useTextSelection(containerRef);
  const { ask, loading, answer, error, dismiss } = useAskAi(endpoint);

  function handleAsk(kind: AskKind, selectedText?: string) {
    if (getWholeContext) {
      ask(kind, getWholeContext(), selectedText);
    } else {
      ask(kind, selectedText ?? "");
    }
    clear();
  }

  return (
    <>
      {selection && (
        <AskAiToolbar
          position={selection}
          onAsk={(kind) => handleAsk(kind, selection.text)}
          kinds={kinds}
        />
      )}
      {showWholeButtons && <AskAiButtons onAsk={(kind) => handleAsk(kind)} disabled={loading} />}
      <AskAiAnswer loading={loading} answer={answer} error={error} onDismiss={dismiss} />
    </>
  );
}
