"use client";

import type { SVGProps } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { AiBackend } from "@/lib/models";

// Real provider logomarks (this is a private, single-user app — not
// distributed — so using the actual brand marks here instead of a generic
// stand-in icon is fine). Each is a from-scratch redraw of the provider's
// public logomark, not a traced/embedded original asset.

function AnthropicLogo(props: SVGProps<SVGSVGElement>) {
  // Anthropic's mark: a stack of angular rays fanning up from a point.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M13.5 3h3.1l6.4 18h-3.4l-1.3-3.9h-6.9l-1.3 3.9H6.7L13.5 3Zm.4 4.6-2.3 6.8h4.9l-2.3-6.8Z" />
      <path d="M7.1 3h3.4L4 21H.6L7.1 3Z" />
    </svg>
  );
}

function OpenAiLogo(props: SVGProps<SVGSVGElement>) {
  // OpenAI's interlocking-loops "flower" knot, simplified to six petals,
  // punched with a matching-parity inner ring via evenodd fill instead of an
  // opaque circle (which would show through as a background-colored disc on
  // a translucent badge fill).
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" {...props}>
      <path d="M12 2c1.7 0 3.1 1.1 3.6 2.6a4 4 0 0 1 3.9 4c1.5.5 2.6 1.9 2.6 3.6 0 1.2-.6 2.3-1.5 3 .1.4.1.8.1 1.1 0 2.2-1.8 4-4 4-.6 0-1.2-.1-1.7-.4A3.98 3.98 0 0 1 12 22a4 4 0 0 1-3-1.4 3.9 3.9 0 0 1-1.7.4c-2.2 0-4-1.8-4-4 0-.4 0-.7.1-1.1A3.97 3.97 0 0 1 2 12.2c0-1.7 1.1-3.1 2.6-3.6a4 4 0 0 1 3.9-4C8.9 3.1 10.3 2 12 2Zm0 2.3c-.9 0-1.7.6-2 1.4l-.3.9-.9.2a2.3 2.3 0 0 0-1.8 2.2v1l-.9.4A2.28 2.28 0 0 0 4.9 12.2c0 .9.5 1.7 1.3 2.1l.9.4-.2 1c-.1.2-.1.5-.1.7 0 1.3 1 2.3 2.3 2.3.4 0 .7-.1 1-.2l.9-.4.6.7c.4.5 1 .8 1.7.8s1.3-.3 1.7-.8l.6-.7.9.4c.3.1.6.2 1 .2 1.3 0 2.3-1 2.3-2.3 0-.2 0-.5-.1-.7l-.2-1 .9-.4c.8-.4 1.3-1.2 1.3-2.1 0-1-.6-1.8-1.5-2.1l-.9-.4v-1a2.3 2.3 0 0 0-1.8-2.2l-.9-.2-.3-.9c-.3-.8-1.1-1.4-2-1.4Z" />
      <circle cx="12" cy="12.2" r="2.6" />
    </svg>
  );
}

function GeminiLogo(props: SVGProps<SVGSVGElement>) {
  // Google Gemini's four-point sparkle, with its signature blue→violet blend.
  const gradId = "gemini-grad";
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <defs>
        <linearGradient id={gradId} x1="2" y1="4" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4B8DF8" />
          <stop offset="0.5" stopColor="#9168E3" />
          <stop offset="1" stopColor="#D8618C" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M12 2c.5 4.3 1.4 7 3 8.6 1.6 1.6 4.3 2.5 8.6 3-4.3.5-7 1.4-8.6 3-1.6 1.6-2.5 4.3-3 8.6-.5-4.3-1.4-7-3-8.6-1.6-1.6-4.3-2.5-8.6-3 4.3-.5 7-1.4 8.6-3 1.6-1.6 2.5-4.3 3-8.6Z"
      />
    </svg>
  );
}

function OpenRouterLogo(props: SVGProps<SVGSVGElement>) {
  // OpenRouter's stylized routing/braid mark — three interwoven strands.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M3 6c4 0 4 12 8 12s4-12 8-12" />
      <path d="M3 18c4 0 4-12 8-12s4 12 8 12" strokeOpacity="0.45" />
    </svg>
  );
}

type LogoComponent = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

// Grouped by underlying company rather than one icon per AiBackend value —
// api/claude_code are both Claude, openai/codex_cli are both OpenAI, so
// each pair shares a logo and the tooltip is what tells them apart (e.g.
// "via the Claude Code CLI" vs "via the Anthropic API").
const PROVIDER_META: Record<AiBackend, { label: string; logo: LogoComponent; className: string }> = {
  api: { label: "Claude", logo: AnthropicLogo, className: "text-[#D97757]" },
  claude_code: { label: "Claude Code", logo: AnthropicLogo, className: "text-[#D97757]" },
  openai: { label: "OpenAI", logo: OpenAiLogo, className: "text-foreground" },
  codex_cli: { label: "Codex CLI", logo: OpenAiLogo, className: "text-foreground" },
  gemini: { label: "Gemini", logo: GeminiLogo, className: "" },
  free: { label: "OpenRouter", logo: OpenRouterLogo, className: "text-focus" },
};

const BADGE_CLASS = "border-focus/30 bg-focus/10 text-focus";

export interface ModelBadgeInfo {
  model_provider: AiBackend | null;
  model_name: string | null;
}

// Renders nothing when there's no provider on the item (generated before
// this was tracked) — callers don't need to check first.
export default function ModelBadge({
  info,
  detail = "detailed",
}: {
  info: ModelBadgeInfo;
  detail?: "detailed" | "minimal";
}) {
  if (!info.model_provider) return null;
  const meta = PROVIDER_META[info.model_provider];
  const Logo = meta.logo;
  const modelKnown = !!info.model_name && info.model_name !== "unknown";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          detail === "minimal" ? (
            <span className={cn("inline-flex cursor-default items-center", meta.className)} />
          ) : (
            <Badge variant="outline" className={cn("gap-1 cursor-default", BADGE_CLASS)} />
          )
        }
      >
        <Logo className={detail === "minimal" ? "size-4" : cn("size-3.5", meta.className)} />
        {detail === "detailed" && meta.label}
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
