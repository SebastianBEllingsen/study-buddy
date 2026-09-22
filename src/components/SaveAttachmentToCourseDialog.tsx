"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CourseSummary, Folder } from "@/lib/models";

// Select needs a string value — this maps to `folderId: null` ("save
// directly on the course page", the same destination a course-page upload
// with no folder chosen lands in).
const COURSE_PAGE_SENTINEL = "__course__";

export interface SaveableAttachment {
  filename: string;
  mimeType: string;
  // Exactly one of these is set — image attachments carry a data URL,
  // document attachments carry raw base64 (see ChatAttachment in models.ts).
  dataUrl?: string;
  fileBase64?: string;
}

// Reuses the existing course-page upload endpoint (POST
// /api/courses/[courseId]/documents) rather than adding new backend logic —
// this only works because chat attachments keep their original bytes (see
// ChatAttachment's doc comment in models.ts), not just extracted text.
async function attachmentToFile(attachment: SaveableAttachment): Promise<File> {
  if (attachment.dataUrl) {
    const blob = await fetch(attachment.dataUrl).then((r) => r.blob());
    return new File([blob], attachment.filename, { type: attachment.mimeType });
  }
  const binary = atob(attachment.fileBase64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], attachment.filename, { type: attachment.mimeType });
}

export default function SaveAttachmentToCourseDialog({
  attachment,
  onOpenChange,
}: {
  attachment: SaveableAttachment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!attachment) return;
    fetch("/api/courses")
      .then((r) => r.json())
      .then((list: CourseSummary[]) => {
        setCourses(list);
        setCourseId(list[0]?.id ?? null);
      })
      .catch(() => toast.error("Couldn't load courses"));
  }, [attachment]);

  useEffect(() => {
    if (courseId === null) return;
    fetch(`/api/courses/${courseId}`)
      .then((r) => r.json())
      .then((detail: { folders: Folder[] }) => {
        setFolders(detail.folders);
        setFolderId(null);
      })
      .catch(() => toast.error("Couldn't load folders"));
  }, [courseId]);

  async function handleSave() {
    if (!attachment || courseId === null) return;
    setSaving(true);
    try {
      const file = await attachmentToFile(attachment);
      const formData = new FormData();
      formData.append("file", file);
      if (folderId !== null) formData.append("folderId", String(folderId));
      const res = await fetch(`/api/courses/${courseId}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      toast.success(`Saved to ${courses.find((c) => c.id === courseId)?.name ?? "course"}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save this attachment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={attachment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save to course</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Course</label>
            <Select
              value={courseId !== null ? String(courseId) : ""}
              onValueChange={(v) => setCourseId(Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a course">
                  {(v: string) => (v ? (courses.find((c) => String(c.id) === v)?.name ?? v) : "Choose a course")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Folder</label>
            <Select
              value={folderId !== null ? String(folderId) : COURSE_PAGE_SENTINEL}
              onValueChange={(v) => setFolderId(v === COURSE_PAGE_SENTINEL ? null : Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    v === COURSE_PAGE_SENTINEL ? "This course page" : (folders.find((f) => String(f.id) === v)?.name ?? v)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={COURSE_PAGE_SENTINEL}>This course page</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || courseId === null}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
