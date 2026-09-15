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
import { useAppTheme, type AppTheme } from "@/components/AppThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { ImageLibraryDialog } from "@/components/ImageLibraryDialog";
import { ICON_ASPECT, ICON_OUTPUT, BACKGROUND_ASPECT, BACKGROUND_OUTPUT_WIDTH, BACKGROUND_OUTPUT_HEIGHT } from "@/lib/imageCropPresets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

function AiSection() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [backend, setBackendState] = useState<AiBackend>("api");
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((body: AppSettings) => {
        setSettings(body);
        setBackendState(body.aiBackend);
      });
  }, []);

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
      setSettings(updated);
      setKeyInput("");
      toast.success(`Now generating with ${AI_LABELS[updated.aiBackend]}`);
    } catch {
      toast.error("Couldn't save AI settings");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
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
    </div>
  );
}

function CalendarSection() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((body: AppSettings) => setSettings(body));
  }, []);

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
      setSettings(updated);
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
      setSettings((prev) => (prev ? { ...prev, googleCalendarConnected: false } : prev));
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
      </h3>
      <p className="text-xs text-muted-foreground">
        Bring your own Google Cloud OAuth client (same &quot;bring your own key&quot; idea as the
        AI providers above) — see the setup steps you were given, then paste the Client ID/Secret
        here.
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
      <Button size="sm" onClick={handleSaveCredentials} disabled={saving}>
        {saving ? "Saving…" : "Save credentials"}
      </Button>

      <div className="space-y-1.5 border-t pt-3">
        {settings.googleCalendarConnected ? (
          <>
            <p className="text-xs text-sage">Connected.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        ) : settings.hasGoogleClientCredentials ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href="/api/calendar/auth" />}
          >
            Connect Google Calendar
          </Button>
        ) : (
          // A disabled <a> has no real browser meaning (unlike a disabled
          // form control), so this stays a plain disabled <button> — no
          // credentials saved yet means nothing to actually link to.
          <Button type="button" variant="outline" size="sm" disabled>
            Connect Google Calendar
          </Button>
        )}
        {!settings.hasGoogleClientCredentials && (
          <p className="text-xs text-muted-foreground">Save your Client ID/Secret first.</p>
        )}
      </div>
    </div>
  );
}

interface CalendarFeed {
  id: number;
  label: string;
  url: string;
  show_on_calendar: boolean;
  show_in_widget: boolean;
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

  async function toggleFeedField(feed: CalendarFeed, field: "show_on_calendar" | "show_in_widget") {
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
      <p className="text-xs text-muted-foreground">
        Add a read-only ICS feed URL — a university portal&apos;s timetable, an LMS&apos;s
        assignment-due-dates feed — and its events show up alongside Google Calendar. Each feed is
        independently toggleable: on the calendar (/calendar and the dashboard&apos;s Upcoming
        widget) and in the dashboard&apos;s Assignments widget.
      </p>

      {feeds && feeds.length > 0 && (
        <ul className="space-y-1.5">
          {feeds.map((feed) => (
            <li key={feed.id} className="space-y-1.5 rounded-lg border bg-muted/30 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{feed.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{feed.url}</p>
                </div>
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
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={feed.show_on_calendar}
                    onCheckedChange={() => toggleFeedField(feed, "show_on_calendar")}
                  />
                  On calendar
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={feed.show_in_widget}
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
  const [migrating, setMigrating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/storage-settings")
      .then((r) => r.json())
      .then((body: StorageSettingsState) => {
        setSettings(body);
        setMode(body.mode);
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

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/storage-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "supabase" ? { mode, connectionString: connectionString.trim() } : { mode }
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't save storage settings");
        return;
      }
      if (!body.ok) {
        setSettings({ mode, hasConnectionString: true, connectionError: body.error });
        toast.error(`Couldn't connect — still on local. ${body.error ?? ""}`);
        return;
      }
      setSettings({
        mode,
        hasConnectionString: mode === "supabase" && !!connectionString.trim(),
        connectionError: null,
      });
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
            From your Supabase project: Settings → Database → Connection string (Session pooler).
            Migrate your local data below before saving, so switching over doesn&apos;t start you
            from an empty database.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={handleMigrate} disabled={migrating}>
            {migrating ? "Migrating…" : "Migrate my local data to Supabase"}
          </Button>
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
        <span>
          Light / dark mode
          <span className="block text-xs text-muted-foreground">
            Independent of the theme below — switches which of its light or dark variant is
            shown.
          </span>
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
          <span className="text-muted-foreground">
            Transparent widgets
            <span className="block text-muted-foreground/70">
              Widgets drop their card background and sit directly on the dashboard.
            </span>
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
        onCropped={(dataUrl) => saveBranding({ appIconImage: dataUrl })}
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
        onCropped={(dataUrl) => {
          saveBranding({ dashboardBackgroundImage: dataUrl });
          fetch("/api/uploaded-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "background", dataUrl }),
          }).catch(() => {});
        }}
      />
      <ImageLibraryDialog
        open={backgroundLibraryOpen}
        onOpenChange={setBackgroundLibraryOpen}
        kind="background"
        onSelect={(dataUrl) => saveBranding({ dashboardBackgroundImage: dataUrl })}
      />
    </div>
  );
}

function DisplaySection() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((body: AppSettings) => setSettings(body));
  }, []);

  async function handleToggle(
    field: "showModelBadge" | "autoOpenGeneratedItems" | "aiGradingEnabled" | "documentBadgesEnabled",
    next: boolean
  ) {
    if (!settings) return;
    setSettings({ ...settings, [field]: next });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't save display settings");
        setSettings((prev) => (prev ? { ...prev, [field]: !next } : prev));
      }
    } catch {
      toast.error("Couldn't save display settings");
      setSettings((prev) => (prev ? { ...prev, [field]: !next } : prev));
    } finally {
      setSaving(false);
    }
  }

  async function saveDocumentBadgeDetail(detail: AppSettings["documentBadgeDetail"]) {
    if (!settings) return;
    const prev = settings.documentBadgeDetail;
    setSettings({ ...settings, documentBadgeDetail: detail });
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentBadgeDetail: detail }),
      });
      if (!res.ok) {
        toast.error("Couldn't save display settings");
        setSettings((s) => (s ? { ...s, documentBadgeDetail: prev } : s));
      }
    } catch {
      toast.error("Couldn't save display settings");
      setSettings((s) => (s ? { ...s, documentBadgeDetail: prev } : s));
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Display</h3>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Show which model generated each item
          <span className="block text-xs text-muted-foreground">
            A small badge next to notes, quizzes, and flashcards.
          </span>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.showModelBadge}
          disabled={saving}
          onChange={(e) => handleToggle("showModelBadge", e.target.checked)}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Jump to newly generated content automatically
          <span className="block text-xs text-muted-foreground">
            Off: stay put and get a dismissible notification instead — it also shows up on the
            course until you open it or dismiss it.
          </span>
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
        <span>
          AI grading for quiz short-answer questions
          <span className="block text-xs text-muted-foreground">
            Off (default): graded locally by keyword match against the model answer — no API call,
            no partial credit. On: the AI judges each answer and gives written feedback, same as
            before this setting existed. Multiple-choice questions are always graded locally
            either way.
          </span>
        </span>
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={settings.aiGradingEnabled}
          disabled={saving}
          onChange={(e) => handleToggle("aiGradingEnabled", e.target.checked)}
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Show document status badges
          <span className="block text-xs text-muted-foreground">
            The &quot;extracted, Np&quot; / &quot;processing…&quot; / &quot;image&quot; pill next to each document.
          </span>
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
    </div>
  );
}

export default function SettingsDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon className="size-3.5" />
        Settings
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            AI model, Google Calendar, calendar feeds, storage, appearance, and display
            preferences.
          </DialogDescription>
        </DialogHeader>

        <AiSection />
        <Separator />
        <CalendarSection />
        <Separator />
        <CalendarFeedsSection />
        <Separator />
        <StorageSection />
        <Separator />
        <BrandingSection />
        <Separator />
        <AppearanceSection />
        <Separator />
        <DisplaySection />
      </DialogContent>
    </Dialog>
  );
}
