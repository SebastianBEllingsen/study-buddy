/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hides the dev-mode indicator badge (bottom-left "N" icon) that `next dev`
  // injects automatically — dev-only UI, never shown in production builds.
  // Compile/runtime error overlays still show up when something's wrong.
  devIndicators: false,
  experimental: {
    // src/proxy.ts runs on every /api route, which makes Next.js buffer
    // request bodies — silently truncated past this limit (default 10MB).
    // Routes enforce their own caps (e.g. 200MB for Anki decks, or none
    // with "Full-resolution uploads"), so this must sit well above them.
    proxyClientMaxBodySize: "1gb",
  },
  // No other site may show this app inside a frame (clickjacking: tricking
  // a click on e.g. a Settings button through an invisible overlay).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
