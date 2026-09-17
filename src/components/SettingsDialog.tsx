"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Calendar,
  Database,
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
import { uploadImage } from "@/lib/uploadImage";
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

  // Render-phase sync, not an effect — same pattern as BrandingSection's
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
            On (default): generation, AI chat, grading, and &quot;tidy with AI&quot; all work as normal.
            Off: use Study Buddy as a plain document/notes/flashcards organizer — every AI control
            hides and no AI call is ever made. Uploading, viewing, and manually organizing
            documents, notes, and flashcards all keep working exactly the same either way.
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
        <label className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm">
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              Full tool access for this CLI backend
              <HelpTooltip>
                Off (default): {AI_LABELS[backend]} runs hardened — no Bash, file, or network
                tools, in a throwaway temp directory. On: it runs with its normal full
                permissions (it can run shell commands, write files, and reach the network),
                confined to a dedicated Study Buddy workspace folder instead of your temp
                directory — never your app&apos;s own project files or database. This also lets
                it see images (Crop &amp; Ask, chat image attachments) instead of refusing them.
              </HelpTooltip>
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">
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
            Claude Code and Codex CLI can&apos;t take image input at all (unless full tool access
            is on above) — pick a different model just for image-bearing requests (Crop &amp; Ask
            on a PDF/image) without switching your main model away from a CLI subscription.
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
            Off (default): graded locally by keyword match against the model answer — no API
            call, no partial credit. On: the AI judges each answer and gives written feedback.
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
            Off (default): normal generation quality. On: lower reasoning effort and a shorter
            response cap everywhere, plus a cheaper, faster model where the provider offers one
            (Claude backends switch to Haiku) — trades some quality for lower cost/token usage.
            Never changes what source text is sent to the model.
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
}

// Read-only external ICS calendar subscriptions (a university student
// portal's timetable, an LMS's assignment-due-dates feed, ...) — merged
// into the Upcoming widget / /calendar alongside Google Calendar (see
// lib/calendarFeeds.ts), never written back to. Deliberately generic
// (label + URL) rather than named for any one provider, so it covers
// whatever feed a viewer actually has.
function CalendarFeedsSection() {
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

  async function toggleFeedField(feed: CalendarFeed, field: "show_on_calendar" | "show_in_widget" | "enabled") {
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
    }
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
        Add a read-only ICS feed URL (e.g. a Canvas or Google Calendar link) to show its events
        alongside Google Calendar.
        <HelpTooltip>
          Any standard iCalendar link works: a university portal&apos;s timetable, an LMS&apos;s
          assignment-due-dates export, a Google Calendar &quot;secret address in iCal
          format&quot;, an Outlook/Office 365 published calendar. Uncheck &quot;Enabled&quot; to
          pause a feed without losing it; the two checkboxes below control where an enabled feed
          shows up.
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
                    disabled={!feed.enabled}
                    onCheckedChange={() => toggleFeedField(feed, "show_on_calendar")}
                  />
                  On calendar
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={feed.show_in_widget}
                    disabled={!feed.enabled}
                    onCheckedChange={() => toggleFeedField(feed, "show_in_widget")}
                  />
                  In assignments widget
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
                Left blank, course covers/icons and other images keep syncing as part of your
                database rows like everything else — this just moves them to a Supabase Storage
                bucket instead, which is lighter on your project&apos;s database bandwidth.
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
                  Moves existing course/app images into this bucket — a one-time bandwidth cost,
                  so run it whenever that&apos;s convenient rather than right now.
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
};

function AppearanceSection() {
  const { theme, setTheme } = useAppTheme();

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Palette className="size-3.5" />
        Appearance
      </h3>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          Light / dark mode
          <HelpTooltip>
            Independent of the theme below — switches which of its light or dark variant is
            shown.
          </HelpTooltip>
        </span>
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
        <p className="text-xs text-muted-foreground">
          Changes the app&apos;s color palette and headings.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Heading font</Label>
        <FontPicker />
        <p className="text-xs text-muted-foreground">
          Independent of the theme above — picks which face headings use, whichever theme
          you&apos;re on. Leave on &quot;Theme default&quot; to let the theme choose.
        </p>
      </div>
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

function BrandingSection() {
  const { data: settings, mutate } = useSWR<AppSettings>("/api/settings");
  const [nameDraft, setNameDraft] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [backgroundCropFile, setBackgroundCropFile] = useState<File | null>(null);
  const [backgroundCropOpen, setBackgroundCropOpen] = useState(false);
  const [backgroundLibraryOpen, setBackgroundLibraryOpen] = useState(false);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  // Render-phase sync, not an effect — see CustomizeCourseDialog's
  // seededFor for the same pattern. "settings" itself is a stable enough
  // key here since this section only cares whether it's arrived yet.
  if (settings && seededFor !== "settings") {
    setNameDraft(settings.appName ?? "");
    setSeededFor("settings");
  }

  async function saveBranding(fields: {
    appName?: string | null;
    appIcon?: string | null;
    appIconImage?: string | null;
    dashboardBackgroundImage?: string | null;
    dashboardBannerStyle?: AppSettings["dashboardBannerStyle"] | null;
    dashboardTransparentWidgets?: boolean;
  }) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      toast.error("Couldn't save branding");
      return;
    }
    const body: AppSettings = await res.json();
    mutate(body, { revalidate: false });
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
        Branding
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
        <p className="text-xs text-muted-foreground">
          An uploaded image (shown in the header and as the browser tab icon) takes priority over
          the emoji when both are set.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Dashboard backdrop</Label>
        <p className="text-xs text-muted-foreground">
          A large atmospheric background behind the home dashboard, like a game&apos;s library page.
        </p>
        <input
          ref={backgroundInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setBackgroundCropFile(file);
              setBackgroundCropOpen(true);
            }
            e.target.value = "";
          }}
        />
        {settings.dashboardBackgroundImage ? (
          <div
            className="relative h-24 rounded-lg border bg-cover bg-center"
            style={{ backgroundImage: `url(${settings.dashboardBackgroundImage})` }}
          >
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute top-1.5 left-1.5"
              onClick={() => setBackgroundLibraryOpen(true)}
              aria-label="Choose a different backdrop from previous uploads"
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
            <Button variant="outline" size="sm" onClick={() => backgroundInputRef.current?.click()}>
              <ImageIcon className="size-3.5" />
              Upload image
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setBackgroundLibraryOpen(true)}
              aria-label="Choose a backdrop from previous uploads"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </div>
        )}
        {settings.dashboardBackgroundImage && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground">Banner style</span>
            <Select
              value={settings.dashboardBannerStyle}
              onValueChange={(value: AppSettings["dashboardBannerStyle"] | null) =>
                value && saveBranding({ dashboardBannerStyle: value })
              }
            >
              <SelectTrigger className="h-8 w-40 text-xs">
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
        )}
        <label className="flex items-center justify-between gap-3 pt-1 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            Transparent widgets
            <HelpTooltip>Widgets drop their card background and sit directly on the dashboard.</HelpTooltip>
          </span>
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            checked={settings.dashboardTransparentWidgets}
            onChange={(e) => saveBranding({ dashboardTransparentWidgets: e.target.checked })}
          />
        </label>
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
        title="Position app icon"
        onCropped={async (blob) => {
          try {
            const url = await uploadImage(blob, "app-icon");
            saveBranding({ appIconImage: url });
          } catch {
            toast.error("Couldn't upload that image");
          }
        }}
      />
      <ImageCropDialog
        open={backgroundCropOpen}
        onOpenChange={(next) => {
          setBackgroundCropOpen(next);
          if (!next) setBackgroundCropFile(null);
        }}
        file={backgroundCropFile}
        aspect={BACKGROUND_ASPECT}
        outputWidth={BACKGROUND_OUTPUT_WIDTH}
        outputHeight={BACKGROUND_OUTPUT_HEIGHT}
        outputFormat="jpeg"
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
          } catch {
            toast.error("Couldn't upload that image");
          }
        }}
      />
      <ImageLibraryDialog
        open={backgroundLibraryOpen}
        onOpenChange={setBackgroundLibraryOpen}
        kind="background"
        onSelect={(url) => saveBranding({ dashboardBackgroundImage: url })}
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
      <h3 className="text-sm font-medium">Display</h3>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          Jump to newly generated content automatically
          <HelpTooltip>
            Off: stay put and get a dismissible notification instead — it also shows up on the
            course until you open it or dismiss it.
          </HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.autoOpenGeneratedItems}
          disabled={saving}
          onChange={(e) => handleToggle("autoOpenGeneratedItems", e.target.checked)}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          Show document status badges
          <HelpTooltip>
            The &quot;extracted, Np&quot; / &quot;processing…&quot; / &quot;image&quot; pill next to each document.
          </HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.documentBadgesEnabled}
          disabled={saving}
          onChange={(e) => handleToggle("documentBadgesEnabled", e.target.checked)}
        />
      </label>
      {settings.documentBadgesEnabled && (
        <div className="flex items-center justify-between gap-3 pl-1 text-xs">
          <span className="text-muted-foreground">Detail level</span>
          <Select
            value={settings.documentBadgeDetail}
            onValueChange={(value: AppSettings["documentBadgeDetail"] | null) =>
              value && saveDocumentBadgeDetail(value)
            }
          >
            <SelectTrigger className="h-8 w-32 text-xs">
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
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          Show which model generated each item
          <HelpTooltip>A small badge next to notes, quizzes, and flashcards.</HelpTooltip>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.showModelBadge}
          disabled={saving}
          onChange={(e) => handleToggle("showModelBadge", e.target.checked)}
        />
      </label>
      {settings.showModelBadge && (
        <div className="flex items-center justify-between gap-3 pl-1 text-xs">
          <span className="text-muted-foreground">Detail level</span>
          <Select
            value={settings.modelBadgeDetail}
            onValueChange={(value: AppSettings["modelBadgeDetail"] | null) =>
              value && saveModelBadgeDetail(value)
            }
          >
            <SelectTrigger className="h-8 w-32 text-xs">
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

export default function SettingsDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => setOpen(true)}>
        <SettingsIcon className="size-4 text-muted-foreground" />
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            AI model, Google Calendar, calendar feeds, storage, appearance, and display
            preferences.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="ai">
          <TabsList>
            <TabsTab value="ai">AI</TabsTab>
            <TabsTab value="calendar">Calendar</TabsTab>
            <TabsTab value="storage">Storage</TabsTab>
            <TabsTab value="appearance">Appearance</TabsTab>
            <TabsTab value="display">Display</TabsTab>
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
            <BrandingSection />
          </TabsPanel>
          <TabsPanel value="display">
            <DisplaySection />
          </TabsPanel>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
