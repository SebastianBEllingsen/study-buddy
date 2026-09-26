"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Flag, LoaderCircle } from "lucide-react";
import { Explain } from "@/components/Explain";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

// "This is wrong": holds the card/question out of review until it's fixed,
// and drops the mistakes it caused. The note is optional but makes the fix
// (by hand or with AI) much easier.
export function ReportWrongButton({
  itemId,
  index,
  onReported,
  size = "xs",
}: {
  itemId: number;
  index: number;
  onReported?: () => void;
  size?: "xs" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/items/${itemId}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index, action: "report", issue }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      toast.error(body?.error ?? "Couldn't report that");
      return;
    }
    setOpen(false);
    setIssue("");
    toast.success("Held out of review — fix it from the set's page or Sources.");
    onReported?.();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Explain id="item.report">
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size={size}
              className="text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <Flag className="size-3.5" />
          This is wrong
        </PopoverTrigger>
      </Explain>
      <PopoverContent className="w-80 space-y-2 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-medium">What&apos;s wrong with it?</p>
        <Textarea
          rows={3}
          value={issue}
          maxLength={500}
          autoFocus
          placeholder="Optional — e.g. the answer should be the other way round"
          onChange={(e) => setIssue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
        <p className="text-xs text-muted-foreground">
          It leaves your reviews until you fix it, keep it, or remove it. Mistakes it caused are cleared.
        </p>
        <div className="flex justify-end">
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
            Hold it back
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
