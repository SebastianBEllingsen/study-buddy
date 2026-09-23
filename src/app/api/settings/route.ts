import {
  getAppSettings,
  setAiBackend,
  setImageAiBackend,
  setProviderKey,
  setShowModelBadge,
  setAutoOpenGeneratedItems,
  setAiGradingEnabled,
  setUnlimitedUploads,
  setDocumentBadgesEnabled,
  setDocumentBadgeDetail,
  setFolderChips,
  setAppWallpaper,
  setHeaderTint,
  setDashboardLinks,
  setCoursePageDisplay,
  setAiEfficiencyMode,
  setCliTrustedModeEnabled,
  setModelBadgeDetail,
  setAiEnabled,
  setGoogleClientCredentials,
  setHomeWidgets,
  setAppBranding,
  HOME_WIDGET_IDS,
  IMAGE_CAPABLE_BACKENDS,
} from "@/lib/models";
import { normalizeFolderChipSettings } from "@/lib/folderChips";
import { normalizeAppWallpaper } from "@/lib/appWallpaper";
import { HEADER_TINT_MODES, parseHeaderTintMode } from "@/lib/headerTint";
import { droppedLinkIconImages, normalizeDashboardLinks } from "@/lib/dashboardLinks";
import { LINK_BRAND_KEYS } from "@/lib/linkIcons";
import type { AiBackend, AiProviderKeyName, HomeWidgetConfig, HomeWidgetId } from "@/lib/models";
import { FONT_CHOICES } from "@/lib/fontChoices";
import { isValidIconImage, isValidPageBackgroundImage } from "@/lib/dataUrlImage";
import { cleanupReplacedImage } from "@/lib/blobStorage/cleanup";
import { isValidIcon } from "@/lib/fieldValidation";
import { parseJsonObjectBody } from "@/lib/requestBody";

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
  const body = await parseJsonObjectBody(request);

  if (body?.aiEnabled !== undefined) {
    if (typeof body.aiEnabled !== "boolean") {
      return Response.json({ error: "aiEnabled must be a boolean" }, { status: 400 });
    }
    await setAiEnabled(body.aiEnabled);
  }

  if (body?.aiBackend !== undefined) {
    if (!VALID_BACKENDS.includes(body.aiBackend as AiBackend)) {
      return Response.json(
        { error: `aiBackend must be one of: ${VALID_BACKENDS.join(", ")}` },
        { status: 400 }
      );
    }
    await setAiBackend(body.aiBackend as AiBackend);
  }

  if (body?.imageAiBackend !== undefined) {
    // null clears the override back to "use aiBackend" — the only other
    // valid values are the backends that actually support image input (see
    // IMAGE_CAPABLE_BACKENDS's doc comment).
    if (body.imageAiBackend !== null && !IMAGE_CAPABLE_BACKENDS.includes(body.imageAiBackend as AiBackend)) {
      return Response.json(
        { error: `imageAiBackend must be one of: ${IMAGE_CAPABLE_BACKENDS.join(", ")}, or null` },
        { status: 400 }
      );
    }
    await setImageAiBackend(body.imageAiBackend as AiBackend | null);
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

  if (body?.unlimitedUploads !== undefined) {
    if (typeof body.unlimitedUploads !== "boolean") {
      return Response.json({ error: "unlimitedUploads must be a boolean" }, { status: 400 });
    }
    await setUnlimitedUploads(body.unlimitedUploads);
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

  if (body?.folderChips !== undefined) {
    const chips = normalizeFolderChipSettings(body.folderChips);
    if (!chips) {
      return Response.json(
        { error: "folderChips must be { enabled: boolean, hidden: string[] }" },
        { status: 400 }
      );
    }
    await setFolderChips(chips);
  }

  for (const field of ["hideCourseBackdrops", "hideCourseIcons"] as const) {
    if (body?.[field] !== undefined) {
      if (typeof body[field] !== "boolean") {
        return Response.json({ error: `${field} must be a boolean` }, { status: 400 });
      }
      await setCoursePageDisplay({ [field]: body[field] });
    }
  }

  if (body?.dashboardLinks !== undefined) {
    const links = normalizeDashboardLinks(body.dashboardLinks, {
      brandKeys: LINK_BRAND_KEYS,
      isValidImageUrl: isValidIconImage,
    });
    if (!links) {
      return Response.json({ error: "dashboardLinks must be a list of links" }, { status: 400 });
    }
    const previous = (await getAppSettings()).dashboardLinks;
    await setDashboardLinks(links);
    // After the write, so the reference check sees the new links: an uploaded
    // icon that no link uses any more is removed from storage, unless it's
    // still used elsewhere (its library entry, a course…).
    await Promise.all(droppedLinkIconImages(previous, links).map((url) => cleanupReplacedImage(url)));
  }

  if (body?.headerTint !== undefined) {
    if (!(HEADER_TINT_MODES as readonly unknown[]).includes(body.headerTint)) {
      return Response.json({ error: `headerTint must be one of ${HEADER_TINT_MODES.join(", ")}` }, { status: 400 });
    }
    await setHeaderTint(parseHeaderTintMode(body.headerTint));
  }

  if (body?.appWallpaper !== undefined) {
    const wallpaper = normalizeAppWallpaper(body.appWallpaper);
    if (!wallpaper) {
      return Response.json(
        { error: "appWallpaper must be { enabled, areas, dim, blur }" },
        { status: 400 }
      );
    }
    await setAppWallpaper(wallpaper);
  }

  if (body?.aiEfficiencyMode !== undefined) {
    if (typeof body.aiEfficiencyMode !== "boolean") {
      return Response.json({ error: "aiEfficiencyMode must be a boolean" }, { status: 400 });
    }
    await setAiEfficiencyMode(body.aiEfficiencyMode);
  }

  if (body?.cliTrustedModeEnabled !== undefined) {
    if (typeof body.cliTrustedModeEnabled !== "boolean") {
      return Response.json({ error: "cliTrustedModeEnabled must be a boolean" }, { status: 400 });
    }
    await setCliTrustedModeEnabled(body.cliTrustedModeEnabled);
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
    if (body.appIcon !== null && !isValidIcon(body.appIcon)) {
      return Response.json({ error: "appIcon must be a short string, or null" }, { status: 400 });
    }
    branding.appIcon = body.appIcon;
  }
  if ("appIconImage" in body) {
    if (body.appIconImage !== null && !isValidIconImage(body.appIconImage)) {
      return Response.json({ error: "Invalid appIconImage" }, { status: 400 });
    }
    branding.appIconImage = body.appIconImage;
  }
  if ("appFont" in body) {
    const validKeys = FONT_CHOICES.map((f) => f.key) as string[];
    if (body.appFont !== null && !validKeys.includes(body.appFont as string)) {
      return Response.json(
        { error: `appFont must be one of: ${validKeys.join(", ")}, or null` },
        { status: 400 }
      );
    }
    branding.appFont = body.appFont as string | null;
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
  if ("dashboardLockBackgroundCrop" in body) {
    if (typeof body.dashboardLockBackgroundCrop !== "boolean") {
      return Response.json({ error: "dashboardLockBackgroundCrop must be a boolean" }, { status: 400 });
    }
    branding.dashboardLockBackgroundCrop = body.dashboardLockBackgroundCrop;
  }
  if ("dashboardBackdropFullPage" in body) {
    if (typeof body.dashboardBackdropFullPage !== "boolean") {
      return Response.json({ error: "dashboardBackdropFullPage must be a boolean" }, { status: 400 });
    }
    branding.dashboardBackdropFullPage = body.dashboardBackdropFullPage;
  }
  if ("dashboardBackdropBlur" in body) {
    if (typeof body.dashboardBackdropBlur !== "number" || !Number.isFinite(body.dashboardBackdropBlur)) {
      return Response.json({ error: "dashboardBackdropBlur must be a number" }, { status: 400 });
    }
    branding.dashboardBackdropBlur = body.dashboardBackdropBlur;
  }
  if (Object.keys(branding).length > 0) {
    // Captured before the write so a replaced/cleared appIconImage or
    // dashboardBackgroundImage's old blob can be cleaned up after — see the
    // cleanupReplacedImage calls below.
    const existing =
      "appIconImage" in branding || "dashboardBackgroundImage" in branding
        ? await getAppSettings()
        : null;
    await setAppBranding(branding);
    if (existing) {
      await Promise.all([
        "appIconImage" in branding
          ? cleanupReplacedImage(existing.appIconImage, branding.appIconImage)
          : Promise.resolve(),
        "dashboardBackgroundImage" in branding
          ? cleanupReplacedImage(existing.dashboardBackgroundImage, branding.dashboardBackgroundImage)
          : Promise.resolve(),
      ]);
    }
  }

  return Response.json(await getAppSettings());
}
