import {
  getAppSettings,
  setAiBackend,
  setProviderKey,
  setShowModelBadge,
  setAutoOpenGeneratedItems,
  setGoogleClientCredentials,
  setHomeWidgets,
  HOME_WIDGET_IDS,
} from "@/lib/models";
import type { AiBackend, AiProviderKeyName, HomeWidgetConfig, HomeWidgetId } from "@/lib/models";

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

  if (body?.aiBackend !== undefined) {
    if (!VALID_BACKENDS.includes(body.aiBackend)) {
      return Response.json(
        { error: `aiBackend must be one of: ${VALID_BACKENDS.join(", ")}` },
        { status: 400 }
      );
    }
    await setAiBackend(body.aiBackend);
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

  return Response.json(await getAppSettings());
}
