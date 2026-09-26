"use client";

import { useState } from "react";
import { RESOURCE_KINDS, type ResourceKind } from "@/lib/studyPlan/types";
import { RESOURCE_KIND_LABEL } from "@/lib/studyPlanDisplay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ResourceDraft {
  url: string;
  title: string;
  kind: ResourceKind;
  note: string;
}

// Adding a link to a chapter (initial undefined) or editing one. The server
// checks the link on save and shows the result as a badge.
export function ResourceEditDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ResourceDraft;
  onSave: (draft: ResourceDraft) => Promise<boolean>;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ResourceKind>("article");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setUrl(initial?.url ?? "");
    setTitle(initial?.title ?? "");
    setKind(initial?.kind ?? "article");
    setNote(initial?.note ?? "");
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const urlValid = /^https?:\/\/\S+$/i.test(url.trim());

  async function handleSave() {
    if (!urlValid) return;
    setSaving(true);
    const ok = await onSave({ url: url.trim(), title: title.trim(), kind, note: note.trim() });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit link" : "Add link"}</DialogTitle>
          <DialogDescription>The link is checked when you save.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="resource-url">Link</Label>
            <Input
              id="resource-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.org/lesson"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="resource-title">Title</Label>
            <Input
              id="resource-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the site name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => v && setKind(v as ResourceKind)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => RESOURCE_KIND_LABEL[v as ResourceKind] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {RESOURCE_KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="resource-note">Note</Label>
            <Input
              id="resource-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What it covers"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!urlValid || saving}>
            {saving ? "Checking…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
