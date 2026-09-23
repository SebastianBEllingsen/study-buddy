"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import ChatContent from "@/components/ChatContent";

// The "detach" destination for ChatDialog's own dialog (see its
// handleDetach) — a real, separate browser window/tab holding the AI chat,
// so it can sit alongside the main app window instead of only ever living
// inside a modal. The root layout's header/max-width shell still wraps this
// route like every other page (there's only the one layout) — fixed
// inset-0 covers it entirely rather than splitting the app into route
// groups for one route.
//
// useSearchParams (for the ?conversation= deep link below) needs a Suspense
// boundary somewhere above it for static generation — see the default
// export at the bottom of this file, same pattern as HomePage/CalendarPage.
function DetachedChatPageContent() {
  const searchParams = useSearchParams();
  const conversationParam = searchParams.get("conversation");
  const parsed = conversationParam ? Number(conversationParam) : NaN;
  const initialConversationId = Number.isInteger(parsed) ? parsed : undefined;

  useEffect(() => {
    // A plain synchronous set here loses a race against the root layout's
    // own async generateMetadata (it resolves server-side and streams the
    // real <title> in after this component's first mount) — deferred to a
    // macrotask so it applies after that settles instead of getting
    // overwritten by it.
    const timer = setTimeout(() => {
      window.document.title = "AI chat";
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div data-slot="detached-page" className="fixed inset-0 z-50 flex flex-col bg-background">
      <ChatContent initialConversationId={initialConversationId} />
    </div>
  );
}

export default function DetachedChatPage() {
  return (
    <Suspense fallback={null}>
      <DetachedChatPageContent />
    </Suspense>
  );
}
