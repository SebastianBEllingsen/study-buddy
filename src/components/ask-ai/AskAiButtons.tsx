"use client";

import { Lightbulb, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AskKind } from "./useAskAi";

export function AskAiButtons({
  onAsk,
  disabled,
}: {
  onAsk: (kind: AskKind) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <Button size="xs" variant="ghost" onClick={() => onAsk("hint")} disabled={disabled}>
        <Lightbulb className="size-3" />
        Hint
      </Button>
      <Button size="xs" variant="ghost" onClick={() => onAsk("explain")} disabled={disabled}>
        <MessageCircleQuestion className="size-3" />
        Explain
      </Button>
    </div>
  );
}
