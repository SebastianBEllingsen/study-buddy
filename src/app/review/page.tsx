"use client";

import { Explain } from "@/components/Explain";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ReviewSession, type ReviewMode } from "@/components/review/ReviewSession";

function ReviewPageInner() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("courseId");
  const courseId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  const concept = searchParams.get("concept")?.trim() ?? "";
  const focus: ReviewMode =
    searchParams.get("mode") === "mistakes"
      ? { mode: "mistakes" }
      : searchParams.get("mode") === "concept" && concept
        ? { mode: "concept", concept }
        : { mode: "due" };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Review</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-semibold">
            {focus.mode === "mistakes" ? "Redo your mistakes" : focus.mode === "concept" ? focus.concept : "Review"}
          </h1>
          <div className="flex gap-1.5">
            {(courseId !== null || focus.mode !== "due") && (
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/review" />}>
                All due reviews
              </Button>
            )}
            <Explain id="mistakes.open">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={courseId === null ? "/mistakes" : `/mistakes?courseId=${courseId}`} />}
            >
              Mistake log
            </Button>
            </Explain>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {focus.mode === "mistakes"
            ? "Your open mistakes, the ones you were sure about first. Get each right on two later days and it clears."
            : focus.mode === "concept"
              ? "Every card and question on this concept, least practised first."
              : "Everything that's due, mixed across your sets and scheduled with spaced repetition. Say how sure you are before you see the answer."}
        </p>
      </div>
      <ReviewSession key={`${courseId}:${focus.mode}:${concept}`} courseId={courseId} focus={focus} />
    </div>
  );
}

// useSearchParams needs a Suspense boundary (see calendar/page.tsx).
export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewPageInner />
    </Suspense>
  );
}
