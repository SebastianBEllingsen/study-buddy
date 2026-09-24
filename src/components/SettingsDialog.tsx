"use client";

import { useEffect, useRef, useState } from "react";
import { FolderChipsPicker } from "@/components/FolderChipsPicker";
import { HEADER_TINT_LABELS, HEADER_TINT_MODES, type HeaderTintMode } from "@/lib/headerTint";
import { AppWallpaperSettings, CoursePageAppearanceSettings } from "@/components/AppWallpaperSettings";
import { SettingGroup, SettingSlider, SettingToggle } from "@/components/SettingToggle";
import { MAX_BACKDROP_BLUR } from "@/lib/backdropBlur";
import type { FolderChipSettings } from "@/lib/folderChips";
import { isSettingsTab, loadSettingsView, saveSettingsView, type SettingsTab, type SettingsView } from "@/lib/settingsView";
import useSWR, { useSWRConfig } from "swr";
import {
  AlertTriangle,
  Calendar,
  Database,
  BookOpen,
  Download,
  Image as ImageIcon,
  MoreHorizontal,
  Palette,
  Rss,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { useAppTheme, type AppTheme } from "@/components/AppThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { ImageLibraryDialog } from "@/components/ImageLibraryDialog";
import { HelpTooltip } from "@/components/HelpTooltip";
import { describeUploadError, uploadImage } from "@/lib/uploadImage";
import { ICON_ASPECT, ICON_OUTPUT, BACKGROUND_ASPECT, BACKGROUND_OUTPUT_WIDTH, BACKGROUND_OUTPUT_HEIGHT } from "@/lib/imageCropPresets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IMAGE_CAPABLE_BACKENDS } from "@/lib/aiBackendChoices";
import type { AiBackend, AppSettings } from "@/lib/models";
import { FONT_CHOICES } from "@/lib/fontChoices";

const AI_LABELS: Record<AiBackend, string> = {
  api: "Anthropic (API key)",
  claude_code: "Claude Code (subscription)",
  codex_cli: "Codex CLI (subscription)",
  openai: "OpenAI (API key)",
  gemini: "Gemini (API key)",
  free: "Free (OpenRouter)",
};

const KEY_PROVIDERS: {
  backend: AiBackend;
  field: keyof AppSettings;
  bodyField: string;
  help: string;
}[] = [
  { backend: "api", field: "hasAnthropicKey", bodyField: "anthropicApiKey", help: "console.anthropic.com" },
  { backend: "openai", field: "hasOpenAiKey", bodyField: "openaiApiKey", help: "platform.openai.com/api-keys" },
  { backend: "gemini", field: "hasGeminiKey", bodyField: "geminiApiKey", help: "aistudio.google.com/apikey" },
  { backend: "free", field: "hasOpenRouterKey", bodyField: "openrouterApiKey", help: "openrouter.ai/keys — free, no credit card required" },
];

type StorageMode = "local" | "supabase";

interface StorageSettingsState {
  mode: StorageMode;
  hasConnectionString: boolean;
  connectionError: string | null;
  storageUrl: string;
  hasStorageServiceKey: boolean;
  storageBucket: string;
}

const STORAGE_LABELS: Record<StorageMode, string> = {
  local: "Local (this device only)",
  supabase: "Supabase (synced)",
};

const BANNER_STYLE_LABELS: Record<AppSettings["dashboardBannerStyle"], string> = {
  overlap: "Widgets overlap it",
  backdrop: "Full backdrop",
};

const DOCUMENT_BADGE_DETAIL_LABELS: Record<AppSettings["documentBadgeDetail"], string> = {
  detailed: "Detailed",
  minimal: "Minimal",
};

const MODEL_BADGE_DETAIL_LABELS: Record<AppSettings["modelBadgeDetail"], string> = {
  detailed: "Detailed",
  minimal: "Minimal",
};

function AiSection() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const [backend, setBackendState] = useState<AiBackend>("api");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [gradingSaving, setGradingSaving] = useState(false);
  const [efficiencySaving, setEfficiencySaving] = useState(false);
  const [cliTrustedModeSaving, setCliTrustedModeSaving] = useState(false);
  const [aiEnabledSaving, setAiEnabledSaving] = useState(false);
  const [imageBackendSaving, setImageBackendSaving] = useState(false);

  // Render-phase sync, not an effect — same pattern as IdentitySection's
  // seededFor. `backend` needs its own local copy (the <Select> below edits
  // it before Save is pressed) seeded once from the shared settings cache.
  if (settings && seededFor !== "settings") {
    setBackendState(settings.aiBackend);
    setSeededFor("settings");
  }

  function handleBackendChange(value: AiBackend) {
    setBackendState(value);
    setKeyInput("");
  }

  const activeKeyProvider = KEY_PROVIDERS.find((p) => p.backend === backend);

  async function handleSave() {
    setSaving(true);
    const body: Record<string, string> = { aiBackend: backend };
    if (activeKeyProvider && keyInput.trim()) {
      body[activeKeyProvider.bodyField] = keyInput.trim();
    }
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Couldn't save AI settings");
        return;
      }
      const updated: AppSettings = await res.json();
      mutate(updated, { revalidate: false });
      setKeyInput("");
      toast.success(`Now generating with ${AI_LABELS[updated.aiBackend]}`);
    } catch {
      toast.error("Couldn't save AI settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleImageBackendChange(value: string) {
    if (!settings) return;
    const imageAiBackend = value === "same" ? null : (value as AiBackend);
    const previous = settings.imageAiBackend;
    mutate({ ...settings, imageAiBackend }, { revalidate: false });
    setImageBackendSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageAiBackend }),
      });
      if (!res.ok) {
        toast.error("Couldn't save image AI model");
        mutate((prev) => (prev ? { ...prev, imageAiBackend: previous } : prev), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save image AI model");
      mutate((prev) => (prev ? { ...prev, imageAiBackend: previous } : prev), { revalidate: false });
    } finally {
      setImageBackendSaving(false);
    }
  }

  async function handleGradingToggle(next: boolean) {
    if (!settings) return;
    mutate({ ...settings, aiGradingEnabled: next }, { revalidate: false });
    setGradingSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiGradingEnabled: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't save AI settings");
        mutate((prev) => (prev ? { ...prev, aiGradingEnabled: !next } : prev), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save AI settings");
      mutate((prev) => (prev ? { ...prev, aiGradingEnabled: !next } : prev), { revalidate: false });
    } finally {
      setGradingSaving(false);
    }
  }

  async function handleEfficiencyToggle(next: boolean) {
    if (!settings) return;
    mutate({ ...settings, aiEfficiencyMode: next }, { revalidate: false });
    setEfficiencySaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiEfficiencyMode: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't save AI settings");
        mutate((prev) => (prev ? { ...prev, aiEfficiencyMode: !next } : prev), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save AI settings");
      mutate((prev) => (prev ? { ...prev, aiEfficiencyMode: !next } : prev), { revalidate: false });
    } finally {
      setEfficiencySaving(false);
    }
  }

  async function handleCliTrustedModeToggle(next: boolean) {
    if (!settings) return;
    mutate({ ...settings, cliTrustedModeEnabled: next }, { revalidate: false });
    setCliTrustedModeSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliTrustedModeEnabled: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't save AI settings");
        mutate((prev) => (prev ? { ...prev, cliTrustedModeEnabled: !next } : prev), {
          revalidate: false,
        });
      }
    } catch {
      toast.error("Couldn't save AI settings");
      mutate((prev) => (prev ? { ...prev, cliTrustedModeEnabled: !next } : prev), {
        revalidate: false,
      });
    } finally {
      setCliTrustedModeSaving(false);
    }
  }

  async function handleAiEnabledToggle(next: boolean) {
    if (!settings) return;
    mutate({ ...settings, aiEnabled: next }, { revalidate: false });
    setAiEnabledSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiEnabled: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't save AI settings");
        mutate((prev) => (prev ? { ...prev, aiEnabled: !next } : prev), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save AI settings");
      mutate((prev) => (prev ? { ...prev, aiEnabled: !next } : prev), { revalidate: false });
    } finally {
      setAiEnabledSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          Enable AI features
          <HelpTooltip>
            Off hides every AI control and makes no AI calls. Everything else works the same.
          </HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.aiEnabled}
          disabled={aiEnabledSaving}
          onChange={(e) => handleAiEnabledToggle(e.target.checked)}
        />
      </label>
      {settings.aiEnabled && (
        <>
      <h3 className="flex items-center gap-1.5 border-t pt-3 text-sm font-medium">
        <Sparkles className="size-3.5" />
        AI model
      </h3>
      <div className="space-y-1.5">
        <Label>Provider</Label>
        <Select value={backend} onValueChange={(v) => handleBackendChange(v as AiBackend)}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v) => AI_LABELS[v as AiBackend] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AI_LABELS) as AiBackend[]).map((value) => (
              <SelectItem key={value} value={value}>
                {AI_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {backend === "claude_code" && (
        <p className="text-xs text-muted-foreground">
          Uses your local Claude Code subscription login — no key needed here, just run{" "}
          <code>claude /login</code> in a terminal.
        </p>
      )}
      {backend === "codex_cli" && (
        <p className="text-xs text-muted-foreground">
          Uses your local Codex CLI subscription login — no key needed here, just run{" "}
          <code>codex login</code> in a terminal.
        </p>
      )}

      {(backend === "claude_code" || backend === "codex_cli") && (
        <label className="flex items-center justify-between gap-3 rounded-md border border-amber/30 bg-amber/10 p-2 text-sm">
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              Full tool access for this CLI backend
              <HelpTooltip>
                Off (default): {AI_LABELS[backend]} runs without shell, file or network access. On:
                it gets its normal tools, limited to a dedicated Study Buddy workspace folder, and
                can read images (Crop &amp; Ask, chat attachments).
              </HelpTooltip>
            </span>
            <span className="text-xs text-amber">
              Only enable if you trust the material you feed it — a malicious PDF could try to
              abuse these tools.
            </span>
          </span>
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            checked={settings.cliTrustedModeEnabled}
            disabled={cliTrustedModeSaving}
            onChange={(e) => handleCliTrustedModeToggle(e.target.checked)}
          />
        </label>
      )}

      {activeKeyProvider && (
        <div className="space-y-1.5">
          <Label>API key</Label>
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={settings[activeKeyProvider.field] ? "configured" : "not set"}
          />
          <p className="text-xs text-muted-foreground">Get one at {activeKeyProvider.help}.</p>
        </div>
      )}

      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      <div className="space-y-1.5 border-t pt-3">
        <Label className="flex items-center gap-1.5">
          Image model (for Crop &amp; Ask)
          <HelpTooltip>
            A separate model for requests that include an image. Useful when your main model
            can&apos;t read images, like a CLI backend without full tool access.
          </HelpTooltip>
        </Label>
        <Select
          value={settings.imageAiBackend ?? "same"}
          onValueChange={(v) => v && handleImageBackendChange(v)}
          disabled={imageBackendSaving}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string) => (v === "same" ? "Same as AI model above" : (AI_LABELS[v as AiBackend] ?? v))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="same">Same as AI model above</SelectItem>
            {IMAGE_CAPABLE_BACKENDS.map((value) => (
              <SelectItem key={value} value={value}>
                {AI_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
        <span className="flex items-center gap-1.5">
          AI grading for quiz short-answer questions
          <HelpTooltip>
            Off: graded by keyword match against the model answer, with no AI call. On: the AI
            judges each answer and gives written feedback.
          </HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.aiGradingEnabled}
          disabled={gradingSaving}
          onChange={(e) => handleGradingToggle(e.target.checked)}
        />
      </label>

      <label className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
        <span className="flex items-center gap-1.5">
          Efficiency mode
          <HelpTooltip>
            Uses less effort, shorter answers and a cheaper model where available. Costs less,
            with somewhat lower quality.
          </HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.aiEfficiencyMode}
          disabled={efficiencySaving}
          onChange={(e) => handleEfficiencyToggle(e.target.checked)}
        />
      </label>
        </>
      )}
    </div>
  );
}

function CalendarSection() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleSaveCredentials() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleClientId: clientId.trim(),
          googleClientSecret: clientSecret.trim(),
        }),
      });
      if (!res.ok) {
        toast.error("Couldn't save Google credentials");
        return;
      }
      const updated: AppSettings = await res.json();
      mutate(updated, { revalidate: false });
      setClientId("");
      setClientSecret("");
      toast.success("Saved — you can connect below now");
    } catch {
      toast.error("Couldn't save Google credentials");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/calendar/disconnect", { method: "POST" });
      if (!res.ok) {
        toast.error("Couldn't disconnect");
        return;
      }
      mutate((prev) => (prev ? { ...prev, googleCalendarConnected: false } : prev), { revalidate: false });
      toast.success("Disconnected Google Calendar");
    } catch {
      toast.error("Couldn't disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Calendar className="size-3.5" />
        Google Calendar
        {settings.googleCalendarConnected && (
          <span className="text-xs font-normal text-sage"> — Connected</span>
        )}
      </h3>
      <p className="text-xs text-muted-foreground">
        Bring your own Google Cloud OAuth client, then paste its Client ID/Secret below.
      </p>

      <div className="space-y-1.5">
        <Label>Client ID</Label>
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={settings.hasGoogleClientCredentials ? "configured" : "not set"}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Client secret</Label>
        <Input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={settings.hasGoogleClientCredentials ? "configured" : "not set"}
        />
      </div>

      {/* Connect/Disconnect is part of the same Google Calendar setup as
          the credentials above it, not a separate step — same row as Save
          credentials (rather than its own section below a divider) makes
          that relationship visually obvious. */}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" onClick={handleSaveCredentials} disabled={saving}>
          {saving ? "Saving…" : "Save credentials"}
        </Button>
        {settings.googleCalendarConnected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : (
          settings.hasGoogleClientCredentials && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href="/api/calendar/auth" />}
            >
              Connect Google Calendar
            </Button>
          )
        )}
      </div>
      {!settings.hasGoogleClientCredentials && (
        <p className="text-xs text-muted-foreground">
          Save your Client ID/Secret first, then Connect appears here.
        </p>
      )}
    </div>
  );
}

interface CalendarFeed {
  id: number;
  label: string;
  url: string;
  show_on_calendar: boolean;
  show_in_widget: boolean;
  enabled: boolean;
  own_calendar: boolean;
}

// Read-only external ICS calendar subscriptions (a university student
// portal's timetable, an LMS's assignment-due-dates feed, ...) — merged
// into the Upcoming widget / /calendar alongside Google Calendar (see
// lib/calendarFeeds.ts), never written back to. Deliberately generic
// (label + URL) rather than named for any one provider, so it covers
// whatever feed a viewer actually has.
function CalendarFeedsSection() {
  const { mutate: globalMutate } = useSWRConfig();
  const [feeds, setFeeds] = useState<CalendarFeed[] | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  function loadFeeds() {
    fetch("/api/calendar-feeds")
      .then((r) => r.json())
      .then((body: { feeds: CalendarFeed[] }) => setFeeds(body.feeds));
  }

  useEffect(loadFeeds, []);

  async function handleAdd() {
    if (!label.trim() || !url.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/calendar-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), url: url.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't add that feed");
        return;
      }
      setLabel("");
      setUrl("");
      loadFeeds();
      toast.success("Feed added");
    } catch {
      toast.error("Couldn't add that feed");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: number) {
    setFeeds((prev) => prev?.filter((f) => f.id !== id) ?? null);
    const res = await fetch(`/api/calendar-feeds/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't remove that feed");
      loadFeeds();
    }
  }

  async function toggleFeedField(
    feed: CalendarFeed,
    field: "show_on_calendar" | "show_in_widget" | "enabled" | "own_calendar"
  ) {
    const next = !feed[field];
    setFeeds((prev) => prev?.map((f) => (f.id === feed.id ? { ...f, [field]: next } : f)) ?? null);
    const res = await fetch(`/api/calendar-feeds/${feed.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
    });
    if (!res.ok) {
      toast.error("Couldn't update that feed");
      loadFeeds();
      return;
    }
    // /calendar reads the same list through SWR — refresh it so a toggled
    // tab/visibility shows up there without a reload.
    globalMutate("/api/calendar-feeds");
  }

  return (
    // `min-w-0`: this is a direct child of DialogContent's own `display:
    // grid`, so — same pitfall as `.dashboard-tile` in globals.css — it
    // gets an implicit `min-width: auto` as a grid item, which sizes to
    // fit its widest descendant's un-wrapped content no matter how deep
    // that descendant's own `truncate`/`overflow-hidden` is nested. A long
    // feed URL (e.g. a real Canvas ICS feed, ~90+ unbroken characters) was
    // silently stretching the WHOLE Settings dialog to fit it, forcing
    // horizontal scrolling on every section, not just this one.
    <div className="min-w-0 space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Rss className="size-3.5" />
        Calendar feeds
      </h3>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Add a read-only calendar (ICS) link to show its events here.
        <HelpTooltip>
          Works with any iCalendar link: a school timetable, an LMS&apos;s due dates, a Google or
          Outlook calendar&apos;s iCal address. Untick Enabled to pause a feed without removing it.
        </HelpTooltip>
      </p>

      {feeds && feeds.length > 0 && (
        <ul className="space-y-1.5">
          {feeds.map((feed) => (
            <li
              key={feed.id}
              className={cn(
                "space-y-1.5 rounded-lg border bg-muted/30 px-2.5 py-1.5",
                !feed.enabled && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    checked={feed.enabled}
                    onCheckedChange={() => toggleFeedField(feed, "enabled")}
                    aria-label={feed.enabled ? `Disable ${feed.label}` : `Enable ${feed.label}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{feed.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{feed.url}</p>
                  </div>
                </label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  onClick={() => handleDelete(feed.id)}
                  aria-label={`Remove ${feed.label}`}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 pl-6">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={feed.show_on_calendar}
                    disabled={!feed.enabled || feed.own_calendar}
                    onCheckedChange={() => toggleFeedField(feed, "show_on_calendar")}
                  />
                  On calendar
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={feed.show_in_widget}
                    disabled={!feed.enabled || feed.own_calendar}
                    onCheckedChange={() => toggleFeedField(feed, "show_in_widget")}
                  />
                  In assignments widget
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={feed.own_calendar}
                    disabled={!feed.enabled}
                    onCheckedChange={() => toggleFeedField(feed, "own_calendar")}
                  />
                  Own tab
                  <HelpTooltip>
                    Gives this feed its own tab on the Calendar page: a week timetable with a colour per
                    course. The feed is then kept out of My calendar, Assignments and the dashboard.
                  </HelpTooltip>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. Canvas" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/feed.ics" />
      </div>
      <Button size="sm" onClick={handleAdd} disabled={adding || !label.trim() || !url.trim()}>
        {adding ? "Adding…" : "Add feed"}
      </Button>
    </div>
  );
}

// "Full-resolution uploads" — lifts the per-kind image size caps (see
// lib/uploadLimits.ts) and the downscaling/compression that keeps uploads
// under them. Lives under Storage since what it trades away is storage
// space and bandwidth.
function UploadLimitToggle() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const [saving, setSaving] = useState(false);
  if (!settings) return null;

  async function handleToggle(next: boolean) {
    mutate((prev) => (prev ? { ...prev, unlimitedUploads: next } : prev), { revalidate: false });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlimitedUploads: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save upload settings");
      mutate((prev) => (prev ? { ...prev, unlimitedUploads: !next } : prev), { revalidate: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
      <span className="flex items-center gap-1.5">
        Full-resolution uploads
        <HelpTooltip>
          Off: images are scaled to how large they&apos;re shown and kept under a size cap. On: stored
          at full resolution, which uses more storage and loads slower. Your storage provider&apos;s own
          per-file limit still applies.
        </HelpTooltip>
      </span>
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={settings.unlimitedUploads}
        disabled={saving}
        onChange={(e) => handleToggle(e.target.checked)}
      />
    </label>
  );
}

function StorageSection() {
  const [settings, setSettings] = useState<StorageSettingsState | null>(null);
  const [mode, setMode] = useState<StorageMode>("local");
  const [connectionString, setConnectionString] = useState("");
  const [storageUrl, setStorageUrl] = useState("");
  const [storageServiceKey, setStorageServiceKey] = useState("");
  const [storageBucket, setStorageBucket] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migratingImages, setMigratingImages] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/storage-settings")
      .then((r) => r.json())
      .then((body: StorageSettingsState) => {
        setSettings(body);
        setMode(body.mode);
        // storageUrl/storageBucket aren't secret, so (unlike
        // connectionString/storageServiceKey) they're safe to prefill from
        // the GET response instead of starting blank every time.
        setStorageUrl(body.storageUrl ?? "");
        setStorageBucket(body.storageBucket ?? "");
      });
  }, []);

  async function handleMigrate() {
    if (!connectionString.trim()) {
      toast.error("Paste a connection string first");
      return;
    }
    setMigrating(true);
    try {
      const res = await fetch("/api/storage-settings/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString: connectionString.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Migration failed");
        return;
      }
      const { migrated } = body;
      toast.success(
        `Copied ${migrated.courses} course(s), ${migrated.generatedItems} generated item(s) to Supabase`
      );
    } catch {
      toast.error("Migration failed");
    } finally {
      setMigrating(false);
    }
  }

  // Rewrites existing base64 images into the now-configured Storage bucket —
  // separate from handleSave (which must already have succeeded, since this
  // needs the *saved* config's blob store, not whatever's currently typed
  // into the form). Reads every matching row's full image data out of the
  // database to re-upload it, so this has a real one-time egress cost —
  // only meant to be run once storage is actually configured and it's a
  // good time to pay that cost.
  async function handleMigrateImages() {
    setMigratingImages(true);
    try {
      const res = await fetch("/api/storage-settings/migrate-images", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Image migration failed");
        return;
      }
      toast.success(
        `Moved images for ${body.coursesMigrated} course(s)${body.brandingMigrated ? ", app branding," : ""} and ${body.imagesMigrated} library image(s) to Storage`
      );
    } catch {
      toast.error("Image migration failed");
    } finally {
      setMigratingImages(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/storage-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "supabase"
            ? {
                mode,
                connectionString: connectionString.trim(),
                storageUrl: storageUrl.trim(),
                storageServiceKey: storageServiceKey.trim(),
                storageBucket: storageBucket.trim(),
              }
            : { mode }
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save storage settings");
        return;
      }
      if (!body.ok) {
        setSettings({
          mode,
          hasConnectionString: true,
          connectionError: body.error,
          storageUrl,
          hasStorageServiceKey: settings?.hasStorageServiceKey || !!storageServiceKey.trim(),
          storageBucket,
        });
        toast.error(`Couldn't connect — still on local. ${body.error ?? ""}`);
        return;
      }
      setSettings({
        mode,
        hasConnectionString: mode === "supabase" && !!connectionString.trim(),
        connectionError: null,
        storageUrl,
        hasStorageServiceKey: settings?.hasStorageServiceKey || !!storageServiceKey.trim(),
        storageBucket,
      });
      // Cleared, not kept — matches connectionString's own treatment; the
      // server already folded it into the saved config (see
      // /api/storage-settings's "leave blank to keep the existing key"
      // handling), so nothing is lost by clearing the input.
      setStorageServiceKey("");
      toast.success(mode === "supabase" ? "Now syncing live with Supabase" : "Switched to local");
    } catch {
      toast.error("Couldn't save storage settings");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  const hasError = !!settings.connectionError;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Database className="size-3.5" />
        Storage
      </h3>
      <p className="text-xs text-muted-foreground">
        Local keeps everything on this device. Supabase syncs your courses and notes across
        devices — bring your own free project.
      </p>

      {hasError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Couldn&apos;t connect to Supabase — using local data instead</AlertTitle>
          <AlertDescription>{settings.connectionError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label>Where to store your data</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as StorageMode)}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v) => STORAGE_LABELS[v as StorageMode] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STORAGE_LABELS) as StorageMode[]).map((value) => (
              <SelectItem key={value} value={value}>
                {STORAGE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "supabase" && (
        <div className="space-y-1.5">
          <Label>Connection string</Label>
          <Input
            type="password"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            placeholder={settings.hasConnectionString ? "configured" : "not set"}
          />
          <p className="text-xs text-muted-foreground">
            From Settings → Database → Connection string (Session pooler) in your Supabase
            project. Migrate your local data below first, or you&apos;ll start from an empty
            database.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={handleMigrate} disabled={migrating}>
            {migrating ? "Migrating…" : "Migrate my local data to Supabase"}
          </Button>

          <div className="space-y-1.5 border-t pt-3">
            <Label className="flex items-center gap-1.5">
              Image storage (optional)
              <HelpTooltip>
                Stores images in a Supabase Storage bucket instead of the database, which uses less
                database bandwidth. Left blank, images stay in the database.
              </HelpTooltip>
            </Label>
            <p className="text-xs text-muted-foreground">
              From your Supabase project: Settings → API for the URL and service_role key, and
              Storage to create a public bucket.
            </p>
            <Input
              value={storageUrl}
              onChange={(e) => setStorageUrl(e.target.value)}
              placeholder="https://<project-ref>.supabase.co"
            />
            <Input
              type="password"
              value={storageServiceKey}
              onChange={(e) => setStorageServiceKey(e.target.value)}
              placeholder={settings.hasStorageServiceKey ? "configured" : "service_role key"}
            />
            <Input
              value={storageBucket}
              onChange={(e) => setStorageBucket(e.target.value)}
              placeholder="Bucket name (must be public)"
            />
            {settings.hasStorageServiceKey && (
              <>
                <p className="text-xs text-muted-foreground">
                  Moves existing images into this bucket. A one-time transfer you can run any time.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleMigrateImages}
                  disabled={migratingImages}
                >
                  {migratingImages ? "Moving…" : "Move existing images to Storage"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      <UploadLimitToggle />

      <div className="space-y-1.5 border-t pt-3">
        <Label>Backup</Label>
        <p className="text-xs text-muted-foreground">
          Download everything — courses, folders, extracted text, and every generated note, quiz,
          and flashcard set with its full review history — as one JSON file.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href="/api/export" />}
        >
          <Download className="size-3.5" />
          Export all data
        </Button>
      </div>
    </div>
  );
}

const APP_THEME_LABELS: Record<AppTheme, string> = {
  calm: "Calm — quiet, focused",
  gamified: "Gamified — bold, arcade-style",
  mono: "Mono — crisp, technical",
  sepia: "Sepia — warm, literary",
  blueprint: "Blueprint — cyanotype, schematic",
  canvas: "Canvas — crimson, courseware",
  solarized: "Solarized — the classic dev palette",
  nord: "Nord — arctic, low-glare",
  terminal: "Terminal — green phosphor, printout",
  sakura: "Sakura — blossom pink, soft",
  chalkboard: "Chalkboard — chalk and whiteboard, hand-drawn",
  highlighter: "Highlighter — exam paper, highlighter swipes",
  "index-card": "Index card — corkboard, card stacks, stamps",
  brutal: "Brutal — thick outlines, buttons that press",
  win98: "Win98 — bevels, title bars, teal desktop",
  synthwave: "Synthwave — neon sunset, rolling grid",
  illuminated: "Illuminated — manuscript, gilded initials",
  holo: "Holo — iridescent foil",
  comic: "Comic — halftone, ink panels, speech balloons",
};

// How the nav bar is colored over the dashboard/course backdrops and the
// app wallpaper — see lib/headerTint.ts and components/AdaptiveHeader.tsx.
function NavBarColorSetting() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  if (!settings) return null;

  async function save(mode: HeaderTintMode) {
    const prev = settings?.headerTint;
    mutate((s) => (s ? { ...s, headerTint: mode } : s), { revalidate: false });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerTint: mode }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save the nav bar setting");
      mutate((s) => (s && prev ? { ...s, headerTint: prev } : s), { revalidate: false });
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        Nav bar color
        <HelpTooltip>
          Over a backdrop or the wallpaper, the nav bar can take its color from the picture under
          it as you scroll.
        </HelpTooltip>
      </Label>
      <Select value={settings.headerTint} onValueChange={(v) => v && save(v as HeaderTintMode)}>
        <SelectTrigger className="w-full">
          <SelectValue>{(v: string) => HEADER_TINT_LABELS[v as HeaderTintMode] ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {HEADER_TINT_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {HEADER_TINT_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useAppTheme();

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Palette className="size-3.5" />
        Theme
      </h3>
      <label className="flex items-center justify-between gap-3 text-sm">
        Light / dark mode
        <ThemeToggle />
      </label>
      <div className="space-y-1.5">
        <Label>Theme</Label>
        <Select value={theme} onValueChange={(v) => v && setTheme(v as AppTheme)}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => APP_THEME_LABELS[v as AppTheme] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(APP_THEME_LABELS) as AppTheme[]).map((value) => (
              <SelectItem key={value} value={value}>
                {APP_THEME_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Heading font</Label>
        <FontPicker />
      </div>
      <NavBarColorSetting />
    </div>
  );
}

// A second, independent axis from the theme's own font (see globals.css's
// data-app-font rules) — DB-backed like the rest of AppSettings rather than
// localStorage like the theme itself, since it also needs to be correct in
// the very first server-rendered response (see layout.tsx's
// generateMetadata/data-app-font) for a flash-free load; the theme has no
// such server-side read today, hence its own localStorage+blocking-script
// mechanism instead.
function FontPicker() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const value = settings?.appFont ?? "theme";

  async function handleChange(next: string) {
    const appFont = next === "theme" ? null : next;
    // Instant feedback in this tab without waiting on the save — same
    // attribute layout.tsx sets server-side on the next full load.
    if (appFont) document.documentElement.setAttribute("data-app-font", appFont);
    else document.documentElement.removeAttribute("data-app-font");
    mutate((prev) => (prev ? { ...prev, appFont } : prev), { revalidate: false });
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appFont }),
    });
    if (!res.ok) toast.error("Couldn't save font");
  }

  if (!settings) return null;

  return (
    <Select value={value} onValueChange={(v) => v && handleChange(v)}>
      <SelectTrigger className="w-full">
        <SelectValue>
          {(v: string) => {
            const font = FONT_CHOICES.find((f) => f.key === v);
            return (
              <span style={font ? { fontFamily: `var(${font.cssVar})` } : undefined}>
                {font?.label ?? "Theme default"}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* Theme default renders in whatever heading font the active theme
            already picks (--heading-font), same as the rest of the app,
            rather than a fixed font of its own. */}
        <SelectItem value="theme" style={{ fontFamily: "var(--heading-font)" }}>
          Theme default
        </SelectItem>
        {FONT_CHOICES.map((font) => (
          <SelectItem key={font.key} value={font.key} style={{ fontFamily: `var(${font.cssVar})` }}>
            {font.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type BrandingFields = {
  appName?: string | null;
  appIcon?: string | null;
  appIconImage?: string | null;
  dashboardBackgroundImage?: string | null;
  dashboardBannerStyle?: AppSettings["dashboardBannerStyle"] | null;
  dashboardTransparentWidgets?: boolean;
  dashboardLockBackgroundCrop?: boolean;
  dashboardBackdropFullPage?: boolean;
  dashboardBackdropBlur?: number;
};

// Shared by the Identity and Backgrounds sections: saves, then takes the
// server's settings as the new cache.
function useSaveBranding() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  async function saveBranding(fields: BrandingFields) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      toast.error("Couldn't save that setting");
      return;
    }
    const body: AppSettings = await res.json();
    mutate(body, { revalidate: false });
  }
  return { settings, saveBranding };
}

function IdentitySection() {
  const { settings, saveBranding } = useSaveBranding();
  const [nameDraft, setNameDraft] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  // Render-phase sync, not an effect — see CustomizeCourseDialog's
  // seededFor for the same pattern. "settings" itself is a stable enough
  // key here since this section only cares whether it's arrived yet.
  if (settings && seededFor !== "settings") {
    setNameDraft(settings.appName ?? "");
    setSeededFor("settings");
  }

  function commitName() {
    if (!settings) return;
    const trimmed = nameDraft.trim();
    if (trimmed === (settings.appName ?? "")) return;
    saveBranding({ appName: trimmed || null });
  }

  if (!settings) return null;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-3.5" />
        Identity
      </h3>
      <div className="space-y-1.5">
        <Label htmlFor="app-name">App name</Label>
        <Input
          id="app-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Study Buddy"
        />
      </div>
      <div className="space-y-1.5">
        <Label>App icon</Label>
        <input
          ref={iconInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setCropFile(file);
              setCropOpen(true);
            }
            e.target.value = "";
          }}
        />
        <div className="flex items-center gap-2">
          {settings.appIconImage ? (
            <div
              className="relative size-10 shrink-0 rounded-md border bg-cover bg-center"
              style={{ backgroundImage: `url(${settings.appIconImage})` }}
            >
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute -top-2 -right-2 size-5"
                onClick={() => saveBranding({ appIconImage: null })}
                aria-label="Remove app icon image"
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => iconInputRef.current?.click()}>
              <ImageIcon className="size-3.5" />
              Upload image
            </Button>
          )}
          <Input
            value={settings.appIcon ?? ""}
            onChange={(e) => saveBranding({ appIcon: e.target.value.trim() || null })}
            placeholder="📚"
            maxLength={8}
            className="h-9 w-16 text-center text-lg"
            aria-label="App icon emoji"
          />
        </div>
        {settings.appIconImage && settings.appIcon && (
          <p className="text-xs text-muted-foreground">The image is shown; the emoji is the fallback.</p>
        )}
      </div>
      <ImageCropDialog
        open={cropOpen}
        onOpenChange={(next) => {
          setCropOpen(next);
          if (!next) setCropFile(null);
        }}
        file={cropFile}
        aspect={ICON_ASPECT}
        outputWidth={ICON_OUTPUT}
        outputHeight={ICON_OUTPUT}
        outputFormat="png"
        uploadKind="app-icon"
        title="Position app icon"
        onCropped={async (blob) => {
          try {
            const url = await uploadImage(blob, "app-icon");
            saveBranding({ appIconImage: url });
          } catch (err) {
            toast.error(describeUploadError(err, "Couldn't upload that image"));
          }
        }}
      />
    </div>
  );
}

function BackgroundsSection() {
  const { settings, saveBranding } = useSaveBranding();
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The slider moves a local draft; the value is saved once it's let go,
  // not on every step of the drag.
  const [blurDraft, setBlurDraft] = useState<number | null>(null);
  async function commitBlur() {
    if (blurDraft === null || !settings) return;
    const next = blurDraft;
    if (next !== settings.dashboardBackdropBlur) await saveBranding({ dashboardBackdropBlur: next });
    setBlurDraft((current) => (current === next ? null : current));
  }

  if (!settings) return null;
  const image = settings.dashboardBackgroundImage;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <ImageIcon className="size-3.5" />
        Backgrounds
      </h3>
      <div className="space-y-1.5">
        <Label>Dashboard backdrop</Label>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setCropFile(file);
              setCropOpen(true);
            }
            e.target.value = "";
          }}
        />
        {image ? (
          <div
            className={
              settings.dashboardLockBackgroundCrop
                ? "relative w-full rounded-lg border bg-center"
                : "relative h-24 rounded-lg border bg-cover bg-center"
            }
            style={{
              backgroundImage: `url(${image})`,
              ...(settings.dashboardLockBackgroundCrop
                ? { aspectRatio: BACKGROUND_ASPECT, backgroundSize: "100% 100%" }
                : {}),
            }}
          >
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute top-1.5 left-1.5"
              onClick={() => setLibraryOpen(true)}
              aria-label="Change backdrop"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute top-1.5 right-1.5"
              onClick={() => saveBranding({ dashboardBackgroundImage: null })}
              aria-label="Remove dashboard backdrop"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <ImageIcon className="size-3.5" />
              Upload image
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setLibraryOpen(true)}
              aria-label="Choose a backdrop from previous uploads"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {image && (
        <SettingGroup>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Banner style</span>
            <Select
              value={settings.dashboardBannerStyle}
              onValueChange={(value: AppSettings["dashboardBannerStyle"] | null) =>
                value && saveBranding({ dashboardBannerStyle: value })
              }
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue>{(v: AppSettings["dashboardBannerStyle"]) => BANNER_STYLE_LABELS[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BANNER_STYLE_LABELS) as AppSettings["dashboardBannerStyle"][]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {BANNER_STYLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SettingSlider
            label="Blur"
            valueLabel={`${blurDraft ?? settings.dashboardBackdropBlur}px`}
            min={0}
            max={MAX_BACKDROP_BLUR}
            value={blurDraft ?? settings.dashboardBackdropBlur}
            onChange={setBlurDraft}
            onCommit={commitBlur}
          />
          <SettingToggle
            label="Lock exact crop"
            help="Keeps the backdrop exactly as you cropped it as the window resizes."
            checked={settings.dashboardLockBackgroundCrop}
            onChange={(checked) => saveBranding({ dashboardLockBackgroundCrop: checked })}
          />
          {settings.dashboardBannerStyle === "backdrop" && (
            <SettingToggle
              label="Full-page backdrop"
              help="Runs the backdrop behind the widgets below your courses too."
              checked={settings.dashboardBackdropFullPage}
              onChange={(checked) => saveBranding({ dashboardBackdropFullPage: checked })}
            />
          )}
        </SettingGroup>
      )}
      <SettingToggle
        label="Transparent widgets"
        help="Widgets drop their card background and sit directly on the dashboard."
        checked={settings.dashboardTransparentWidgets}
        onChange={(checked) => saveBranding({ dashboardTransparentWidgets: checked })}
      />
      <AppWallpaperSettings />
      <ImageCropDialog
        open={cropOpen}
        onOpenChange={(next) => {
          setCropOpen(next);
          if (!next) setCropFile(null);
        }}
        file={cropFile}
        aspect={BACKGROUND_ASPECT}
        outputWidth={BACKGROUND_OUTPUT_WIDTH}
        outputHeight={BACKGROUND_OUTPUT_HEIGHT}
        outputFormat="auto"
        uploadKind="dashboard-background"
        title="Position dashboard backdrop"
        onCropped={async (blob) => {
          try {
            const url = await uploadImage(blob, "dashboard-background");
            saveBranding({ dashboardBackgroundImage: url });
            fetch("/api/uploaded-images", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "background", url }),
            }).catch(() => {});
          } catch (err) {
            toast.error(describeUploadError(err, "Couldn't upload that image"));
          }
        }}
      />
      <ImageLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        kind="background"
        onSelect={(url) => saveBranding({ dashboardBackgroundImage: url })}
        onUpload={() => inputRef.current?.click()}
      />
    </div>
  );
}

function DisplaySection() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const [saving, setSaving] = useState(false);

  async function handleToggle(
    field: "showModelBadge" | "autoOpenGeneratedItems" | "documentBadgesEnabled",
    next: boolean
  ) {
    if (!settings) return;
    mutate({ ...settings, [field]: next }, { revalidate: false });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't save display settings");
        mutate((prev) => (prev ? { ...prev, [field]: !next } : prev), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save display settings");
      mutate((prev) => (prev ? { ...prev, [field]: !next } : prev), { revalidate: false });
    } finally {
      setSaving(false);
    }
  }

  async function saveFolderChips(next: FolderChipSettings) {
    if (!settings) return;
    const prev = settings.folderChips;
    mutate({ ...settings, folderChips: next }, { revalidate: false });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderChips: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save display settings");
      mutate((s) => (s ? { ...s, folderChips: prev } : s), { revalidate: false });
    }
  }

  async function saveDocumentBadgeDetail(detail: AppSettings["documentBadgeDetail"]) {
    if (!settings) return;
    const prev = settings.documentBadgeDetail;
    mutate({ ...settings, documentBadgeDetail: detail }, { revalidate: false });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentBadgeDetail: detail }),
      });
      if (!res.ok) {
        toast.error("Couldn't save display settings");
        mutate((s) => (s ? { ...s, documentBadgeDetail: prev } : s), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save display settings");
      mutate((s) => (s ? { ...s, documentBadgeDetail: prev } : s), { revalidate: false });
    } finally {
      setSaving(false);
    }
  }

  async function saveModelBadgeDetail(detail: AppSettings["modelBadgeDetail"]) {
    if (!settings) return;
    const prev = settings.modelBadgeDetail;
    mutate({ ...settings, modelBadgeDetail: detail }, { revalidate: false });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelBadgeDetail: detail }),
      });
      if (!res.ok) {
        toast.error("Couldn't save display settings");
        mutate((s) => (s ? { ...s, modelBadgeDetail: prev } : s), { revalidate: false });
      }
    } catch {
      toast.error("Couldn't save display settings");
      mutate((s) => (s ? { ...s, modelBadgeDetail: prev } : s), { revalidate: false });
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <BookOpen className="size-3.5" />
        Course pages
      </h3>
      <SettingToggle
        label="Open generated content when it's ready"
        help="Off: you get a notification instead, and a dot on the course until you open it."
        checked={settings.autoOpenGeneratedItems}
        disabled={saving}
        onChange={(checked) => handleToggle("autoOpenGeneratedItems", checked)}
      />
      <SettingToggle
        label="Show document status badges"
        help="The pill next to each document: pages extracted, still processing, or image."
        checked={settings.documentBadgesEnabled}
        disabled={saving}
        onChange={(checked) => handleToggle("documentBadgesEnabled", checked)}
      />
      {settings.documentBadgesEnabled && (
        <div className="flex items-center justify-between gap-3 pl-4 text-sm">
          <span className="text-muted-foreground">Detail level</span>
          <Select
            value={settings.documentBadgeDetail}
            onValueChange={(value: AppSettings["documentBadgeDetail"] | null) =>
              value && saveDocumentBadgeDetail(value)
            }
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue>
                {(v: AppSettings["documentBadgeDetail"]) => DOCUMENT_BADGE_DETAIL_LABELS[v] ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DOCUMENT_BADGE_DETAIL_LABELS) as AppSettings["documentBadgeDetail"][]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {DOCUMENT_BADGE_DETAIL_LABELS[value]}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          Folder tags
          <HelpTooltip>
            The counts after each folder&apos;s name on course pages. A course can choose its own in
            Customize course.
          </HelpTooltip>
        </span>
        <FolderChipsPicker value={settings.folderChips} onChange={saveFolderChips} />
      </div>
      <SettingToggle
        label="Show which model generated each item"
        help="A small badge next to notes, quizzes, and flashcards."
        checked={settings.showModelBadge}
        disabled={saving}
        onChange={(checked) => handleToggle("showModelBadge", checked)}
      />
      {settings.showModelBadge && (
        <div className="flex items-center justify-between gap-3 pl-4 text-sm">
          <span className="text-muted-foreground">Detail level</span>
          <Select
            value={settings.modelBadgeDetail}
            onValueChange={(value: AppSettings["modelBadgeDetail"] | null) =>
              value && saveModelBadgeDetail(value)
            }
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue>
                {(v: AppSettings["modelBadgeDetail"]) => MODEL_BADGE_DETAIL_LABELS[v] ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODEL_BADGE_DETAIL_LABELS) as AppSettings["modelBadgeDetail"][]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {MODEL_BADGE_DETAIL_LABELS[value]}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// Scrolls `el` to `target`, retrying each frame for a moment: a tab's
// sections load their settings asynchronously, so the dialog may not be
// tall enough to reach the saved position on the first try. Gives up the
// moment the user scrolls, clicks or types themselves. Returns a cancel.
function restoreScroll(el: HTMLElement, target: number, restoring: { current: boolean }): () => void {
  let frame = 0;
  let done = false;
  const started = performance.now();
  const stop = () => {
    if (done) return;
    done = true;
    restoring.current = false;
    cancelAnimationFrame(frame);
    for (const type of USER_SCROLL_EVENTS) el.removeEventListener(type, stop);
  };
  const step = () => {
    if (done) return;
    el.scrollTop = target;
    if (Math.abs(el.scrollTop - target) <= 1 || performance.now() - started > 1500) stop();
    else frame = requestAnimationFrame(step);
  };
  restoring.current = true;
  for (const type of USER_SCROLL_EVENTS) el.addEventListener(type, stop, { passive: true });
  step();
  return stop;
}

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

// Reopens on whichever tab was open last, scrolled to where that tab was
// left — see lib/settingsView.ts for what's remembered and where.
export default function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("ai");
  // The dialog's scroll container, as state rather than a ref so the
  // restore effect below runs once it has actually mounted.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const view = useRef<SettingsView>({ tab: "ai", scroll: {} });
  const restoring = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open || !scroller) return;
    return restoreScroll(scroller, view.current.scroll[tab] ?? 0, restoring);
  }, [open, scroller, tab]);

  function handleOpenChange(next: boolean) {
    if (next) {
      view.current = loadSettingsView();
      setTab(view.current.tab);
    } else {
      clearTimeout(saveTimer.current);
      saveSettingsView(view.current);
    }
    setOpen(next);
  }

  function handleTabChange(value: unknown) {
    if (!isSettingsTab(value)) return;
    view.current = { ...view.current, tab: value };
    setTab(value);
    saveSettingsView(view.current);
  }

  // Positions the restore sets are skipped — mid-restore, before the
  // content has loaded, they're still short of the real target.
  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    if (restoring.current) return;
    view.current = { ...view.current, scroll: { ...view.current.scroll, [tab]: event.currentTarget.scrollTop } };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveSettingsView(view.current), 200);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => handleOpenChange(true)}>
        <SettingsIcon className="size-4 text-muted-foreground" />
      </Button>
      <DialogContent ref={setScroller} onScroll={handleScroll} className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          {/* Screen-reader only: the tabs below already say what's here. */}
          <DialogDescription className="sr-only">Study Buddy settings</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={handleTabChange}>
          {/* Tighter tabs on a phone so all five fit without a hidden
              horizontal scroll. "display" keeps its id so a remembered tab
              (lib/settingsView.ts) still opens the right one. */}
          <TabsList>
            <TabsTab value="ai" className="px-1.5 sm:px-2.5">AI</TabsTab>
            <TabsTab value="calendar" className="px-1.5 sm:px-2.5">Calendar</TabsTab>
            <TabsTab value="storage" className="px-1.5 sm:px-2.5">Storage</TabsTab>
            <TabsTab value="appearance" className="px-1.5 sm:px-2.5">Appearance</TabsTab>
            <TabsTab value="display" className="px-1.5 sm:px-2.5">Courses</TabsTab>
            <TabsIndicator />
          </TabsList>
          <TabsPanel value="ai">
            <AiSection />
          </TabsPanel>
          <TabsPanel value="calendar">
            <CalendarSection />
            <Separator />
            <CalendarFeedsSection />
          </TabsPanel>
          <TabsPanel value="storage">
            <StorageSection />
          </TabsPanel>
          <TabsPanel value="appearance">
            <AppearanceSection />
            <Separator />
            <IdentitySection />
            <Separator />
            <BackgroundsSection />
          </TabsPanel>
          <TabsPanel value="display">
            <DisplaySection />
            <CoursePageAppearanceSettings />
          </TabsPanel>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
