/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hides the dev-mode indicator badge (bottom-left "N" icon) that `next dev`
  // injects automatically — dev-only UI, never shown in production builds.
  // Compile/runtime error overlays still show up when something's wrong.
  devIndicators: false,
};

module.exports = nextConfig;
