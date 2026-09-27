/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hides the dev-mode indicator badge (bottom-left "N" icon) that `next dev`
  // injects automatically — dev-only UI, never shown in production builds.
  // Compile/runtime error overlays still show up when something's wrong.
  devIndicators: false,
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
