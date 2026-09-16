import {
  getAppSettings,
  setAiBackend,
  setImageAiBackend,
  setProviderKey,
  setShowModelBadge,
  setAutoOpenGeneratedItems,
  setAiGradingEnabled,
  setDocumentBadgesEnabled,
  setDocumentBadgeDetail,
  setAiEfficiencyMode,
  setModelBadgeDetail,
  setAiEnabled,
  setGoogleClientCredentials,
  setHomeWidgets,
  setAppBranding,
  HOME_WIDGET_IDS,
  IMAGE_CAPABLE_BACKENDS,
} from "@/lib/models";
import type { AiBackend, AiProviderKeyName, HomeWidgetConfig, HomeWidgetId } from "@/lib/models";
import { FONT_CHOICES } from "@/lib/fontChoices";
import { isValidPageBackgroundImage } from "@/lib/dataUrlImage";

// Same reasoning/cap family as course customization's icon image (see
// api/courses/[courseId]/route.ts) — the app icon plays the same "small
// square badge" role, just at the app level instead of per-course.
const MAX_APP_ICON_IMAGE_LENGTH = 1_500_000;

const VALID_BACKENDS: AiBackend[] = [
  "api",
  "claude_code",
  "codex_cli",
  "openai",
  "gemini",
  "free",
];

// Maps the request body's key field names to the internal provider names
// setProviderKey expects.
const KEY_FIELDS: Record<string, AiProviderKeyName> = {
  anthropicApiKey: "anthropic",
  openaiApiKey: "openai",
  geminiApiKey: "gemini",
  openrouterApiKey: "openrouter",
};

export async function GET() {
  return Response.json(await getAppSettings());
}

export async function POST(request: Request) {
  const body = await request.json();

  if (body?.aiEnabled !== undefined) {
    if (typeof body.aiEnabled !== "boolean") {
      return Response.json({ error: "aiEnabled must be a boolean" }, { status: 400 });
    }
    await setAiEnabled(body.aiEnabled);
  }

  if (body?.aiBackend !== undefined) {
    if (!VALID_BACKENDS.includes(body.aiBackend)) {
      return Response.json(
        { error: `aiBackend must be one of: ${VALID_BACKENDS.join(", ")}` },
        { status: 400 }
      );
    }
    await setAiBackend(body.aiBackend);
  }

  if (body?.imageAiBackend !== undefined) {
    // null clears the override back to "use aiBackend" — the only other
    // valid values are the backends that actually support image input (see
    // IMAGE_CAPABLE_BACKENDS's doc comment).
    if (body.imageAiBackend !== null && !IMAGE_CAPABLE_BACKENDS.includes(body.imageAiBackend)) {
      return Response.json(
        { error: `imageAiBackend must be one of: ${IMAGE_CAPABLE_BACKENDS.join(", ")}, or null` },
        { status: 400 }
      );
    }
    await setImageAiBackend(body.imageAiBackend);
  }

  for (const [field, providerName] of Object.entries(KEY_FIELDS)) {
    if (body?.[field] !== undefined) {
      const value = body[field];
      if (typeof value !== "string") {
        return Response.json({ error: `${field} must be a string` }, { status: 400 });
      }
      // An empty string clears the key; a non-empty one sets it.
      await setProviderKey(providerName, value);
    }
  }

  if (body?.showModelBadge !== undefined) {
    if (typeof body.showModelBadge !== "boolean") {
      return Response.json({ error: "showModelBadge must be a boolean" }, { status: 400 });
    }
    await setShowModelBadge(body.showModelBadge);
  }

  if (body?.autoOpenGeneratedItems !== undefined) {
    if (typeof body.autoOpenGeneratedItems !== "boolean") {
      return Response.json({ error: "autoOpenGeneratedItems must be a boolean" }, { status: 400 });
    }
    await setAutoOpenGeneratedItems(body.autoOpenGeneratedItems);
  }

  if (body?.aiGradingEnabled !== undefined) {
    if (typeof body.aiGradingEnabled !== "boolean") {
      return Response.json({ error: "aiGradingEnabled must be a boolean" }, { status: 400 });
    }
    await setAiGradingEnabled(body.aiGradingEnabled);
  }

  if (body?.documentBadgesEnabled !== undefined) {
    if (typeof body.documentBadgesEnabled !== "boolean") {
      return Response.json({ error: "documentBadgesEnabled must be a boolean" }, { status: 400 });
    }
    await setDocumentBadgesEnabled(body.documentBadgesEnabled);
  }

  if (body?.documentBadgeDetail !== undefined) {
    if (body.documentBadgeDetail !== "detailed" && body.documentBadgeDetail !== "minimal") {
      return Response.json(
        { error: "documentBadgeDetail must be \"detailed\" or \"minimal\"" },
        { status: 400 }
      );
    }
    await setDocumentBadgeDetail(body.documentBadgeDetail);
  }

  if (body?.aiEfficiencyMode !== undefined) {
    if (typeof body.aiEfficiencyMode !== "boolean") {
      return Response.json({ error: "aiEfficiencyMode must be a boolean" }, { status: 400 });
    }
    await setAiEfficiencyMode(body.aiEfficiencyMode);
  }

  if (body?.modelBadgeDetail !== undefined) {
    if (body.modelBadgeDetail !== "detailed" && body.modelBadgeDetail !== "minimal") {
      return Response.json(
        { error: "modelBadgeDetail must be \"detailed\" or \"minimal\"" },
        { status: 400 }
      );
    }
    await setModelBadgeDetail(body.modelBadgeDetail);
  }

  if (body?.googleClientId !== undefined || body?.googleClientSecret !== undefined) {
    const clientId = body.googleClientId;
    const clientSecret = body.googleClientSecret;
    if (typeof clientId !== "string" || typeof clientSecret !== "string") {
      return Response.json(
        { error: "googleClientId and googleClientSecret must both be provided as strings" },
        { status: 400 }
      );
    }
    await setGoogleClientCredentials(clientId, clientSecret);
  }

  if (body?.homeWidgets !== undefined) {
    const widgets = body.homeWidgets;
    const isNonNegativeNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    const valid =
      Array.isArray(widgets) &&
      widgets.length === HOME_WIDGET_IDS.length &&
      HOME_WIDGET_IDS.every((id) => widgets.some((w: HomeWidgetConfig) => w?.id === id)) &&
      widgets.every(
        (w: HomeWidgetConfig) =>
          HOME_WIDGET_IDS.includes(w?.id as HomeWidgetId) &&
          typeof w?.enabled === "boolean" &&
          isNonNegativeNumber(w?.col) &&
          isNonNegativeNumber(w?.row) &&
          isNonNegativeNumber(w?.colSpan) &&
          isNonNegativeNumber(w?.rowSpan)
      );
    if (!valid) {
      return Response.json(
        {
          error: `homeWidgets must include each of ${HOME_WIDGET_IDS.join(", ")} exactly once, each with numeric col/row/colSpan/rowSpan`,
        },
        { status: 400 }
      );
    }
    await setHomeWidgets(widgets);
  }

  const branding: Parameters<typeof setAppBranding>[0] = {};
  if ("appName" in body) {
    if (body.appName !== null && (typeof body.appName !== "string" || body.appName.length > 60)) {
      return Response.json({ error: "appName must be a string up to 60 characters, or null" }, { status: 400 });
    }
    branding.appName = typeof body.appName === "string" ? body.appName.trim() || null : null;
  }
  if ("appIcon" in body) {
    // A handful of grapheme clusters at most — plenty for an emoji, even a
    // multi-codepoint one — same bound as a course's own icon field.
    if (body.appIcon !== null && (typeof body.appIcon !== "string" || body.appIcon.length > 16)) {
      return Response.json({ error: "appIcon must be a short string, or null" }, { status: 400 });
    }
    branding.appIcon = body.appIcon;
  }
  if ("appIconImage" in body) {
    if (
      body.appIconImage !== null &&
      (typeof body.appIconImage !== "string" ||
        !body.appIconImage.startsWith("data:image/") ||
        body.appIconImage.length > MAX_APP_ICON_IMAGE_LENGTH)
    ) {
      return Response.json({ error: "Invalid appIconImage" }, { status: 400 });
    }
    branding.appIconImage = body.appIconImage;
  }
  if ("appFont" in body) {
    const validKeys = FONT_CHOICES.map((f) => f.key) as string[];
    if (body.appFont !== null && !validKeys.includes(body.appFont)) {
      return Response.json(
        { error: `appFont must be one of: ${validKeys.join(", ")}, or null` },
        { status: 400 }
      );
    }
    branding.appFont = body.appFont;
  }
  if ("dashboardBackgroundImage" in body) {
    if (
      body.dashboardBackgroundImage !== null &&
      !isValidPageBackgroundImage(body.dashboardBackgroundImage)
    ) {
      return Response.json({ error: "Invalid dashboard backdrop image" }, { status: 400 });
    }
    branding.dashboardBackgroundImage = body.dashboardBackgroundImage;
  }
  if ("dashboardBannerStyle" in body) {
    if (body.dashboardBannerStyle !== "overlap" && body.dashboardBannerStyle !== "backdrop" && body.dashboardBannerStyle !== null) {
      return Response.json(
        { error: "dashboardBannerStyle must be \"overlap\", \"backdrop\", or null" },
        { status: 400 }
      );
    }
    branding.dashboardBannerStyle = body.dashboardBannerStyle;
  }
  if ("dashboardTransparentWidgets" in body) {
    if (typeof body.dashboardTransparentWidgets !== "boolean") {
      return Response.json({ error: "dashboardTransparentWidgets must be a boolean" }, { status: 400 });
    }
    branding.dashboardTransparentWidgets = body.dashboardTransparentWidgets;
  }
  if (Object.keys(branding).length > 0) {
    await setAppBranding(branding);
  }

  return Response.json(await getAppSettings());
}
