"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import useSWR from "swr";
import {
  ExternalLink,
  FileQuestion,
  FileText,
  Globe,
  HelpCircle,
  Layers,
  NotebookPen,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import NoteMarkdown from "@/components/NoteMarkdown";
import { fetchNoteImage, noteImageCache } from "@/lib/noteImages";
import { CANVAS_SIDES, MIN_NODE_SIZE, parseFileRef, type CanvasFileRef, type CanvasSide } from "@/lib/canvas";
import type { CanvasFlowNode } from "@/lib/canvasFlow";
import type { GenerationMode, LinkTargets, Note } from "@/lib/models";
import { buildNoteLinkHref } from "@/lib/noteLinks";
import { youTubeEmbedUrl } from "@/lib/youtube";
import YouTubeEmbed from "@/components/YouTubeEmbed";
import { cardAccentStyle, useCanvasActions } from "./CanvasContext";

const SIDE_POSITION: Record<CanvasSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const MODE_ICON: Record<GenerationMode, LucideIcon> = {
  notes: NotebookPen,
  quiz: HelpCircle,
  flashcards: Layers,
};

// Where a file card leads when opened — the same destinations a [[link]]
// to it inside a note would, so a canvas is just another way into the
// material. null for an image (nothing to open) or a deleted target.
export function fileCardHref(ref: CanvasFileRef, subpath: string | undefined, targets: LinkTargets): string | null {
  if (ref.type === "image") return null;
  if (ref.type === "note") return `/vault/${ref.id}`;
  const snippet = subpath?.replace(/^#/, "") || undefined;
  return buildNoteLinkHref({ type: ref.type, id: ref.id, snippet }, targets);
}

// Four connection dots (one per side, id'd by side so fromSide/toSide
// round-trip — see lib/canvasFlow.ts) plus the selection resize frame.
// Every handle is a "source": the board runs in ConnectionMode.Loose, so
// any dot can start or finish an arrow, same as Obsidian.
function NodeChrome({ selected, keepAspectRatio }: { selected: boolean; keepAspectRatio?: boolean }) {
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_NODE_SIZE.width}
        minHeight={MIN_NODE_SIZE.height}
        keepAspectRatio={keepAspectRatio}
        handleClassName="canvas-resize-handle"
        lineClassName="canvas-resize-line"
      />
      {CANVAS_SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={SIDE_POSITION[side]} className="canvas-handle" />
      ))}
    </>
  );
}

// --- Text card ---

function TextCardEditor({ id, initial, height }: { id: string; initial: string; height: number | undefined }) {
  const { setEditingId, updateNodeData, resizeNode } = useCanvasActions();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grows the card to fit as you type (never shrinks it — a card you've
  // deliberately sized bigger stays that size), like Obsidian.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || height === undefined) return;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow > 0) resizeNode(id, { height: height + overflow }, false);
  }, [value, height, id, resizeNode]);

  function finish() {
    updateNodeData(id, { text: value }, true);
    setEditingId(null);
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        updateNodeData(id, { text: e.target.value }, false);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      spellCheck
      className="nodrag nowheel nopan canvas-card-body w-full resize-none overflow-y-auto bg-transparent font-mono text-[14px] outline-none"
      placeholder="Write something — markdown works"
    />
  );
}

export const TextNode = memo(function TextNode({ id, data, selected, height }: NodeProps<CanvasFlowNode>) {
  const { editingId, targets } = useCanvasActions();
  const editing = editingId === id;
  return (
    <>
      <NodeChrome selected={selected} />
      <div className="canvas-card" style={cardAccentStyle(data.color)}>
        {editing ? (
          <TextCardEditor id={id} initial={data.text ?? ""} height={height} />
        ) : (
          <div className="canvas-card-body markdown-body">
            <NoteMarkdown markdown={data.text ?? ""} targets={targets} />
          </div>
        )}
      </div>
    </>
  );
});

// --- File cards (note / document / generated item / image) ---

function CardHeader({ icon: Icon, title, href }: { icon: LucideIcon; title: string; href: string | null }) {
  const { navigate } = useCanvasActions();
  return (
    <div className="canvas-card-header">
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {href && (
        <button
          type="button"
          className="nodrag -mr-1 rounded p-1 hover:bg-muted hover:text-foreground"
          aria-label={`Open ${title}`}
          title="Open"
          onClick={(e) => {
            e.stopPropagation();
            navigate(href);
          }}
        >
          <ExternalLink className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function MissingCard({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center text-sm text-muted-foreground">
      <FileQuestion className="size-5" />
      {label}
    </div>
  );
}

// A live, read-only preview of a Vault note — edits happen in the note
// itself (open it via the header button or by double-clicking the card).
function NoteCard({ noteId }: { noteId: number }) {
  const { targets } = useCanvasActions();
  const { data, error } = useSWR<{ note: Note }>(`/api/notes/${noteId}`);
  if (error) {
    return (
      <>
        <CardHeader icon={StickyNote} title="Missing note" href={null} />
        <MissingCard label="This note was deleted." />
      </>
    );
  }
  return (
    <>
      <CardHeader icon={StickyNote} title={data?.note.title ?? "Loading…"} href={`/vault/${noteId}`} />
      {data && (
        <div className="canvas-card-body markdown-body">
          <NoteMarkdown markdown={data.note.markdown} targets={targets} />
        </div>
      )}
    </>
  );
}

function MaterialCard({ refTarget, subpath }: { refTarget: CanvasFileRef; subpath?: string }) {
  const { targets } = useCanvasActions();
  const href = fileCardHref(refTarget, subpath, targets);
  const entry =
    refTarget.type === "doc"
      ? targets.documents.find((d) => d.id === refTarget.id)
      : targets.items.find((i) => i.id === refTarget.id);
  const snippet = subpath?.replace(/^#/, "");

  if (!entry) {
    const noun = refTarget.type === "doc" ? "document" : "item";
    return (
      <>
        <CardHeader icon={FileQuestion} title={`Missing ${noun}`} href={null} />
        <MissingCard label={`This ${noun} was deleted.`} />
      </>
    );
  }
  const title = "filename" in entry ? entry.filename : entry.title;
  const icon = "mode" in entry ? MODE_ICON[entry.mode] : FileText;
  return (
    <>
      <CardHeader icon={icon} title={title} href={href} />
      <div className="canvas-card-body space-y-2 text-sm">
        <p className="text-muted-foreground">{entry.courseName}</p>
        {snippet && (
          <blockquote className="border-l-2 border-[var(--card-accent,var(--border))] pl-3 italic">{snippet}</blockquote>
        )}
      </div>
    </>
  );
}

function ImageCard({ imageId }: { imageId: number }) {
  const [src, setSrc] = useState<string | null>(() => noteImageCache.get(imageId) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (noteImageCache.has(imageId)) return;
    let cancelled = false;
    fetchNoteImage(imageId).then((url) => {
      if (cancelled) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  if (failed) return <MissingCard label="This image was deleted." />;
  if (!src) return <div className="size-full animate-pulse bg-muted" />;
  // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded blob/data URL, not a next/image-optimizable asset
  return <img src={src} alt="" draggable={false} className="size-full object-contain" />;
}

export const FileNode = memo(function FileNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const ref = parseFileRef(data.file ?? "");
  const isImage = ref?.type === "image";
  return (
    <>
      <NodeChrome selected={selected} keepAspectRatio={isImage} />
      <div
        className={cn("canvas-card", isImage && "bg-transparent")}
        style={cardAccentStyle(data.color)}
      >
        {!ref ? (
          <>
            <CardHeader icon={FileQuestion} title={data.file ?? "Unknown file"} href={null} />
            <MissingCard label="This card points at a file that isn't part of Study Buddy." />
          </>
        ) : ref.type === "note" ? (
          <NoteCard noteId={ref.id} />
        ) : ref.type === "image" ? (
          <ImageCard imageId={ref.id} />
        ) : (
          <MaterialCard refTarget={ref} subpath={data.subpath} />
        )}
      </div>
    </>
  );
});

// --- Web link card ---

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const LinkNode = memo(function LinkNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const url = data.url ?? "";
  const safe = /^https?:\/\//i.test(url);
  const embed = youTubeEmbedUrl(url);
  if (embed) {
    // A video link plays right on the card; drag it by the header, since
    // the player itself (nodrag) takes the pointer.
    return (
      <>
        <NodeChrome selected={selected} />
        <div className="canvas-card" style={cardAccentStyle(data.color)}>
          <div className="canvas-card-header">
            <Globe className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{hostnameOf(url)}</span>
          </div>
          <div className="nodrag min-h-0 flex-1">
            <YouTubeEmbed src={embed} fill />
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <NodeChrome selected={selected} />
      <div className="canvas-card" style={cardAccentStyle(data.color)}>
        <div className="canvas-card-header">
          <Globe className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{hostnameOf(url)}</span>
        </div>
        <div className="canvas-card-body text-sm">
          {safe ? (
            <a href={url} target="_blank" rel="noreferrer" className="nodrag break-all text-focus underline">
              {url}
            </a>
          ) : (
            <span className="break-all text-muted-foreground">{url}</span>
          )}
        </div>
      </div>
    </>
  );
});

// --- Group ---

function GroupLabelEditor({ id, initial }: { id: string; initial: string }) {
  const { setEditingId, updateNodeData } = useCanvasActions();
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        updateNodeData(id, { label: value.trim() }, true);
        setEditingId(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="nodrag canvas-group-label w-64 outline-none ring-2 ring-ring"
      placeholder="Group name"
    />
  );
}

export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { editingId, setEditingId } = useCanvasActions();
  const editing = editingId === id;
  return (
    <>
      <NodeChrome selected={selected} />
      <div className="canvas-group" style={cardAccentStyle(data.color)} data-canvas-group-body="">
        {editing ? (
          <GroupLabelEditor id={id} initial={data.label ?? ""} />
        ) : (
          data.label !== "" && (
            <div
              className="canvas-group-label"
              style={cardAccentStyle(data.color)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(id);
              }}
            >
              {data.label || "Untitled group"}
            </div>
          )
        )}
      </div>
    </>
  );
});

export const canvasNodeTypes = {
  text: TextNode,
  file: FileNode,
  link: LinkNode,
  group: GroupNode,
};
