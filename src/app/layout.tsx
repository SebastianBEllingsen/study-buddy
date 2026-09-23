import type { Metadata } from "next";
import Link from "next/link";
import {
  Geist,
  Geist_Mono,
  Source_Serif_4,
  Space_Grotesk,
  Spectral,
  IBM_Plex_Sans,
  Lato,
  JetBrains_Mono,
  Nunito,
  Kalam,
  Bricolage_Grotesque,
  Courier_Prime,
  Archivo_Black,
  Pixelify_Sans,
  Orbitron,
  Cinzel,
  Cinzel_Decorative,
  Syne,
  Bangers,
} from "next/font/google";
import { Calendar } from "lucide-react";
import SearchDialog from "@/components/SearchDialog";
import SettingsDialog from "@/components/SettingsDialog";
import ChatDialog from "@/components/ChatDialog";
import HelpDialog from "@/components/HelpDialog";
import ThemeProvider from "@/components/ThemeProvider";
import AppThemeProvider from "@/components/AppThemeProvider";
import SWRProvider from "@/components/SWRProvider";
import AppBranding from "@/components/AppBranding";
import AppWallpaper from "@/components/AppWallpaper";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import ExternalLinkHandler from "@/components/ExternalLinkHandler";
import PomodoroProvider from "@/components/pomodoro/PomodoroProvider";
import PomodoroButton from "@/components/pomodoro/PomodoroButton";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { getAppSettings } from "@/lib/models";
import { appThemeBootScript } from "@/lib/appThemes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Heading face for the "Gamified" appearance theme — see globals.css's
// `--heading-font` override under [data-app-theme="gamified"].
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Heading face for the "Sepia" appearance theme. "Mono" reuses Geist Mono
// above instead of adding a font — see globals.css.
const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Heading face for the "Blueprint" appearance theme — a technical/drafting
// sans, fitting the cyanotype schematic look. See globals.css.
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Heading face for the "Canvas" appearance theme — Lato is Canvas LMS's own
// UI typeface, the most recognizable detail to borrow along with its
// crimson brand red. See globals.css.
const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// Heading faces for the "Terminal" and "Sakura" appearance themes. Not
// preloaded: unlike the UI fonts they're only needed when that theme is
// picked, so every other viewer skips the download. See globals.css.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  preload: false,
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  preload: false,
});

// Heading faces for the study-desk themes (Chalkboard, Highlighter, Index
// card, Brutal) — not preloaded, same reasoning as the two above.
const kalam = Kalam({ variable: "--font-kalam", subsets: ["latin"], weight: ["400", "700"], preload: false });
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  preload: false,
});
const courierPrime = Courier_Prime({
  variable: "--font-courier-prime",
  subsets: ["latin"],
  weight: ["400", "700"],
  preload: false,
});
const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  subsets: ["latin"],
  weight: "400",
  preload: false,
});

// Heading faces for the maximal themes (Win98, Synthwave, Illuminated,
// Holo, Comic) — not preloaded either. Cinzel Decorative is only the
// Illuminated drop cap.
const pixelify = Pixelify_Sans({ variable: "--font-pixelify", subsets: ["latin"], weight: ["500", "700"], preload: false });
const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["600", "800"], preload: false });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"], weight: ["600", "700"], preload: false });
const cinzelDecorative = Cinzel_Decorative({
  variable: "--font-cinzel-decorative",
  subsets: ["latin"],
  weight: "700",
  preload: false,
});
const syne = Syne({ variable: "--font-syne", subsets: ["latin"], weight: ["700", "800"], preload: false });
const bangers = Bangers({ variable: "--font-bangers", subsets: ["latin"], weight: "400", preload: false });


// Server-rendered (not just a client fetch) so a renamed/rebranded app
// shows its real title and favicon on the very first response — see
// AppBranding.tsx for how the header wordmark stays live after that.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  return {
    title: settings.appName || "Study Buddy",
    description: "Generate notes, quizzes, and flashcards from your course PDFs.",
    icons: settings.appIcon || settings.appIconImage ? { icon: "/api/app-icon" } : undefined,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const settings = await getAppSettings();
  return (
    <html
      lang="en"
      data-app-font={settings.appFont ?? undefined}
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${spaceGrotesk.variable} ${spectral.variable} ${ibmPlexSans.variable} ${lato.variable} ${jetbrainsMono.variable} ${nunito.variable} ${kalam.variable} ${bricolage.variable} ${courierPrime.variable} ${archivoBlack.variable} ${pixelify.variable} ${orbitron.variable} ${cinzel.variable} ${cinzelDecorative.variable} ${syne.variable} ${bangers.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appThemeBootScript() }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AppThemeProvider>
            <SWRProvider>
              <PomodoroProvider>
              {/* sticky rather than static so a page that fills the viewport
                  below it (see vault/[noteId]/page.tsx's full-bleed note view)
                  still always has the header in view, without restructuring
                  the whole app into a fixed-height/nested-scroll shell. */}
              <header data-slot="app-header" className="sticky top-0 z-40 shrink-0 border-b bg-card">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <AppBranding initial={settings} />
                  <div className="flex items-center gap-2">
                    {/* Two visual groups instead of five buttons in a row with
                        mismatched labeled/icon-only/variant styling: named
                        destinations first (Calendar, Search), then a divider,
                        then equally-weighted icon-only utility actions (Pomodoro
                        timer, Chat, Settings, Help) — grouped so the header
                        reads as two decisions instead of six. The timer turns
                        into a live countdown chip while a session runs. */}
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="gap-1.5 px-3 text-xs" nativeButton={false} render={<Link href="/calendar" />}>
                        <Calendar className="size-3.5" />
                        Calendar
                      </Button>
                      <SearchDialog />
                    </div>
                    <div className="h-5 w-px shrink-0 bg-border" />
                    <div className="flex items-center gap-1">
                      <PomodoroButton />
                      <ChatDialog />
                      <SettingsDialog />
                      <HelpDialog />
                    </div>
                  </div>
                </div>
              </header>
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
                {children}
              </main>
              <Toaster />
              <AppWallpaper />
              <AdaptiveHeader />
              <ExternalLinkHandler />
              </PomodoroProvider>
            </SWRProvider>
          </AppThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
