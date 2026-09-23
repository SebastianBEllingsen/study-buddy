"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Briefcase,
  Calculator,
  CalendarDays,
  Code,
  FileText,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  Image as ImageIcon,
  Languages,
  Library,
  Link2,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Music,
  Newspaper,
  PenLine,
  Plus,
  ShoppingCart,
  Star,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppSettings } from "@/lib/models";
import {
  GENERIC_LINK_ICONS,
  MAX_DASHBOARD_LINKS,
  MAX_LINK_TITLE,
  brandKeyForUrl,
  normalizeLinkUrl,
  titleFromUrl,
  type DashboardLink,
  type GenericLinkIcon,
} from "@/lib/dashboardLinks";
import { LINK_BRANDS, linkBrand } from "@/lib/linkIcons";
import { relativeLuminance } from "@/lib/headerTint";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { ImageLibraryDialog } from "@/components/ImageLibraryDialog";
import { ICON_ASPECT, ICON_OUTPUT } from "@/lib/imageCropPresets";
import { describeUploadError, uploadImage } from "@/lib/uploadImage";

const GENERIC_ICONS: Record<GenericLinkIcon, LucideIcon> = {
  globe: Globe,
  book: BookOpen,
  graduation: GraduationCap,
  library: Library,
  file: FileText,
  folder: Folder,
  calendar: CalendarDays,
  mail: Mail,
  chat: MessageCircle,
  video: Video,
  music: Music,
  image: ImageIcon,
  code: Code,
  calculator: Calculator,
  flask: FlaskConical,
  languages: Languages,
  news: Newspaper,
  briefcase: Briefcase,
  cart: ShoppingCart,
  map: MapIcon,
  pen: PenLine,
  star: Star,
  heart: Heart,
  link: Link2,
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// A site logo in its brand color — except near-black and near-white brand
// colors (X, GitHub, Wikipedia…), which would vanish on a dark or light
// theme, so those take the text color instead.
function BrandLogo({ brandKey, className }: { brandKey: string; className?: string }) {
  const brand = linkBrand(brandKey);
  if (!brand) return <Globe className={className} />;
  const luminance = relativeLuminance(hexToRgb(brand.icon.hex));
  const fill = luminance < 0.05 || luminance > 0.85 ? "currentColor" : `#${brand.icon.hex}`;
  return (
    <svg role="img" viewBox="0 0 24 24" className={className} fill={fill} aria-hidden>
      <path d={brand.icon.path} />
    </svg>
  );
}

// Draws a link's icon: see DashboardLink.icon for the forms it can take.
export function LinkIcon({ icon, url, className }: { icon: string; url: string; className?: string }) {
  if (icon.startsWith("brand:")) return <BrandLogo brandKey={icon.slice(6)} className={className} />;
  if (icon.startsWith("image:")) {
    return (
      <span
        className={cn("block shrink-0 rounded-sm bg-contain bg-center bg-no-repeat", className)}
        style={{ backgroundImage: `url(${JSON.stringify(icon.slice(6))})` }}
      />
    );
  }
  if (icon.startsWith("icon:")) {
    const Icon = GENERIC_ICONS[icon.slice(5) as GenericLinkIcon] ?? Globe;
    return <Icon className={cn("text-muted-foreground", className)} />;
  }
  if (icon.startsWith("emoji:")) {
    return <span className={cn("flex items-center justify-center leading-none", className)}>{icon.slice(6)}</span>;
  }
  const detected = brandKeyForUrl(url, LINK_BRANDS);
  return detected ? (
    <BrandLogo brandKey={detected} className={className} />
  ) : (
    <Globe className={cn("text-muted-foreground", className)} />
  );
}

// The dashboard's Links widget: the user's own shortcuts. Links open in the
// user's browser (see ExternalLinkHandler). A one-row tile is a strip of
// icons; anything bigger shows each link's name under its icon. The links
// are edited from the dashboard's Customize dialog (LinksEditorDialog).
export default function LinksWidget({
  layout,
  label,
  transparent,
}: {
  layout: { colSpan: number; rowSpan: number };
  label?: string;
  transparent: boolean;
}) {
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const links = settings?.dashboardLinks ?? [];
  const strip = layout.rowSpan === 1;

  if (strip) {
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={cn("h-full flex-row items-center gap-1 overflow-hidden px-3", transparent ? "" : "border")}
      >
        <div className="scrollbar-hover flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {links.length === 0 && (
            <span className="text-sm text-muted-foreground">No links yet. Add them in Customize.</span>
          )}
          {links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.title}
              aria-label={link.title}
              className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
            >
              <LinkIcon icon={link.icon} url={link.url} className="size-5 text-xl" />
            </a>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl", transparent ? "" : "border")}>
      <div className={cn("flex shrink-0 items-center justify-between gap-2 px-4 py-2", transparent ? "" : "border-b bg-card")}>
        <span className="flex items-center gap-1.5 font-heading text-sm font-semibold">
          <Link2 className="size-4 text-focus" />
          {label ?? "Links"}
        </span>
      </div>
      <div className={cn("scrollbar-hover min-h-0 flex-1 overflow-y-auto p-2", transparent ? "" : "bg-card")}>
        {links.length === 0 ? (
          <p className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            No links yet. Add them in Customize.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1">
            {links.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                title={link.url}
                className="flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-1.5 py-2.5 text-center hover:bg-muted"
              >
                <LinkIcon icon={link.icon} url={link.url} className="size-6 text-2xl" />
                <span className="w-full truncate text-xs">{link.title}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type Draft = DashboardLink;

function newDraft(): Draft {
  return { id: crypto.randomUUID(), title: "", url: "", icon: "auto" };
}

// Opened from the Links widget's tile in the dashboard's Customize dialog.
export function LinksEditorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const links = settings?.dashboardLinks ?? [];
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Seeded each time the dialog opens, from the saved links.
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setDrafts(links.length ? links.map((l) => ({ ...l })) : [newDraft()]);
    setShowErrors(false);
  }
  if (!open && seeded) setSeeded(false);

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  function move(index: number, by: number) {
    setDrafts((ds) => {
      const next = [...ds];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  }

  // Rows left completely blank are ignored rather than blocking the save.
  const filled = drafts.filter((d) => d.url.trim() || d.title.trim());
  const invalid = new Set(filled.filter((d) => !normalizeLinkUrl(d.url)).map((d) => d.id));

  async function save() {
    if (invalid.size > 0) {
      setShowErrors(true);
      return;
    }
    const next = filled.map((d) => {
      const url = normalizeLinkUrl(d.url)!;
      return { ...d, url, title: d.title.trim() || titleFromUrl(url) };
    });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardLinks: next }),
      });
      if (!res.ok) throw new Error();
      mutate((s) => (s ? { ...s, dashboardLinks: next } : s), { revalidate: true });
      onOpenChange(false);
    } catch {
      toast.error("Couldn't save your links");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit links</DialogTitle>
          <DialogDescription>Well-known sites get their logo automatically. Click an icon to change it.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1">
          {drafts.map((draft, i) => {
            const error = showErrors && invalid.has(draft.id);
            return (
              <li key={draft.id} className="flex items-start gap-2 rounded-lg border p-2">
                <IconPicker value={draft.icon} url={draft.url} onChange={(icon) => update(draft.id, { icon })} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input
                    value={draft.title}
                    maxLength={MAX_LINK_TITLE}
                    placeholder="Name"
                    aria-label="Link name"
                    onChange={(e) => update(draft.id, { title: e.target.value })}
                  />
                  <Input
                    value={draft.url}
                    placeholder="example.com"
                    aria-label="Link address"
                    aria-invalid={error || undefined}
                    onChange={(e) => update(draft.id, { url: e.target.value })}
                  />
                  {error && <p className="text-xs text-destructive">Enter a web address, like example.com.</p>}
                </div>
                <div className="flex flex-col">
                  <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move down"
                    disabled={i === drafts.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove link"
                    onClick={() => setDrafts((ds) => ds.filter((d) => d.id !== draft.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={drafts.length >= MAX_DASHBOARD_LINKS}
          onClick={() => setDrafts((ds) => [...ds, newDraft()])}
        >
          <Plus className="size-3.5" />
          Add link
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PickerTab = "sites" | "icons" | "emoji" | "upload";

function IconPicker({ value, url, onChange }: { value: string; url: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("sites");
  const [query, setQuery] = useState("");
  const [emoji, setEmoji] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const normalized = normalizeLinkUrl(url) ?? "";

  // Same square crop and storage as a course badge image, and recorded in
  // the same "previous uploads" library so it can be reused.
  async function handleCropped(blob: Blob) {
    try {
      const uploaded = await uploadImage(blob, "icon");
      fetch("/api/uploaded-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "icon", url: uploaded }),
      }).catch(() => {});
      onChange(`image:${uploaded}`);
    } catch (err) {
      toast.error(describeUploadError(err, "Couldn't upload that image"));
    }
  }

  function pick(icon: string) {
    onChange(icon);
    setOpen(false);
  }

  const brands = LINK_BRANDS.filter((b) => b.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="icon" className="size-[4.25rem] shrink-0" aria-label="Choose icon" />}
      >
        <LinkIcon icon={value} url={normalized} className="size-7 text-3xl" />
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 p-2" align="start">
        <div className="flex items-center gap-1">
          <Button
            variant={value === "auto" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => pick("auto")}
            title="Use the site's logo if it's a well-known site, otherwise a globe"
          >
            Auto
          </Button>
          {(["sites", "icons", "emoji", "upload"] as const).map((t) => (
            <Button key={t} variant={tab === t ? "secondary" : "ghost"} size="sm" onClick={() => setTab(t)}>
              {PICKER_TAB_LABELS[t]}
            </Button>
          ))}
        </div>
        {tab === "sites" && (
          <>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites" className="h-7" />
            <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
              {brands.map((brand) => (
                <button
                  key={brand.key}
                  type="button"
                  title={brand.label}
                  aria-label={brand.label}
                  onClick={() => pick(`brand:${brand.key}`)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md hover:bg-muted",
                    value === `brand:${brand.key}` && "bg-muted ring-1 ring-ring"
                  )}
                >
                  <BrandLogo brandKey={brand.key} className="size-5" />
                </button>
              ))}
              {brands.length === 0 && <p className="col-span-6 py-3 text-center text-xs text-muted-foreground">No match</p>}
            </div>
          </>
        )}
        {tab === "icons" && (
          <div className="grid grid-cols-6 gap-1">
            {GENERIC_LINK_ICONS.map((key) => {
              const Icon = GENERIC_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  onClick={() => pick(`icon:${key}`)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md hover:bg-muted",
                    value === `icon:${key}` && "bg-muted ring-1 ring-ring"
                  )}
                >
                  <Icon className="size-5" />
                </button>
              );
            })}
          </div>
        )}
        {tab === "upload" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <ImageIcon className="size-3.5" />
                Upload image
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setLibraryOpen(true);
                }}
              >
                Previous uploads
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Cropped to a square. Transparent backgrounds are kept.</p>
          </div>
        )}
        {tab === "emoji" && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (emoji.trim()) pick(`emoji:${emoji.trim()}`);
            }}
          >
            <Input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="Type or paste an emoji"
              maxLength={8}
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={!emoji.trim()}>
              Use
            </Button>
          </form>
        )}
      </PopoverContent>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setCropFile(file);
          e.target.value = "";
        }}
      />
      <ImageCropDialog
        open={cropFile !== null}
        onOpenChange={(next) => {
          if (!next) setCropFile(null);
        }}
        file={cropFile}
        aspect={ICON_ASPECT}
        outputWidth={ICON_OUTPUT}
        outputHeight={ICON_OUTPUT}
        outputFormat="png"
        uploadKind="icon"
        title="Position link icon"
        onCropped={handleCropped}
      />
      <ImageLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        kind="icon"
        imageLabel="link icon"
        onSelect={(picked) => onChange(`image:${picked}`)}
        onUpload={() => fileInputRef.current?.click()}
      />
    </Popover>
  );
}

const PICKER_TAB_LABELS: Record<PickerTab, string> = {
  sites: "Sites",
  icons: "Icons",
  emoji: "Emoji",
  upload: "Upload",
};
