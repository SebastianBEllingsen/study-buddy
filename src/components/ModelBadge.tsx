"use client";

import { Sparkles, Bot, Gem, Route, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { AiBackend } from "@/lib/models";

// Grouped by underlying company rather than one icon per AiBackend value —
// api/claude_code are both Claude, openai/codex_cli are both OpenAI, so
// each pair shares an icon and the tooltip is what tells them apart (e.g.
// "via the Claude Code CLI" vs "via the Anthropic API"). All providers
// share one quiet tint (the Focus accent) — the icon and label are what
// distinguish them, not four unrelated colors standing in for "provider".
const PROVIDER_META: Record<AiBackend, { label: string; icon: LucideIcon }> = {
  api: { label: "Claude", icon: Sparkles },
  claude_code: { label: "Claude Code", icon: Sparkles },
  openai: { label: "OpenAI", icon: Bot },
  codex_cli: { label: "Codex CLI", icon: Bot },
  gemini: { label: "Gemini", icon: Gem },
  free: { label: "OpenRouter", icon: Route },
};

const BADGE_CLASS = "border-focus/30 bg-focus/10 text-focus";

export interface ModelBadgeInfo {
  model_provider: AiBackend | null;
  model_name: string | null;
}

// Renders nothing when there's no provider on the item (generated before
// this was tracked) — callers don't need to check first.
export default function ModelBadge({ info }: { info: ModelBadgeInfo }) {
  if (!info.model_provider) return null;
  const meta = PROVIDER_META[info.model_provider];
  const Icon = meta.icon;
  const modelKnown = !!info.model_name && info.model_name !== "unknown";

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="outline" className={cn("gap-1 cursor-default", BADGE_CLASS)} />}
      >
        <Icon />
        {meta.label}
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{meta.label}</p>
        <p className="text-background/70">
          {modelKnown
            ? `Model: ${info.model_name}`
            : "Exact model isn't reported by this backend"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
