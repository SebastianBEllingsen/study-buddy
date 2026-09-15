import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Source_Serif_4, Space_Grotesk, Spectral, IBM_Plex_Sans, Lato } from "next/font/google";
import { Calendar } from "lucide-react";
import SearchDialog from "@/components/SearchDialog";
import SettingsDialog from "@/components/SettingsDialog";
import ChatDialog from "@/components/ChatDialog";
import HelpDialog from "@/components/HelpDialog";
import ThemeProvider from "@/components/ThemeProvider";
import AppThemeProvider from "@/components/AppThemeProvider";
import SWRProvider from "@/components/SWRProvider";
import AppBranding from "@/components/AppBranding";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { getAppSettings } from "@/lib/models";
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

// Sets data-app-theme before first paint (same reasoning as next-themes'
// own blocking script for the class attribute) so a viewer who picked a
// non-default theme doesn't see a flash of "calm" on load — see
// AppThemeProvider.tsx, which keeps this list of valid values in sync.
const APP_THEME_SCRIPT = `try{var t=localStorage.getItem('studybuddy-app-theme');if(t==='gamified'||t==='mono'||t==='sepia'||t==='blueprint'||t==='canvas')document.documentElement.setAttribute('data-app-theme',t)}catch(e){}`;

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
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${spaceGrotesk.variable} ${spectral.variable} ${ibmPlexSans.variable} ${lato.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AppThemeProvider>
            <SWRProvider>
              {/* sticky rather than static so a page that fills the viewport
                  below it (see vault/[noteId]/page.tsx's full-bleed note view)
                  still always has the header in view, without restructuring
                  the whole app into a fixed-height/nested-scroll shell. */}
              <header className="sticky top-0 z-40 shrink-0 border-b bg-card">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <AppBranding initial={settings} />
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="gap-1.5 px-3 text-xs" nativeButton={false} render={<Link href="/calendar" />}>
                      <Calendar className="size-3.5" />
                      Calendar
                    </Button>
                    <SearchDialog />
                    <ChatDialog />
                    <SettingsDialog />
                    <HelpDialog />
                  </div>
                </div>
              </header>
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
                {children}
              </main>
              <Toaster />
            </SWRProvider>
          </AppThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
