import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// This file is ESM (.mts), so no __dirname global — derive it from
// import.meta.url instead.
const dirname = path.dirname(fileURLToPath(import.meta.url));

// Unit tests only, for now — pure business-logic modules under src/lib
// (see each *.test.ts's own file). No DOM/React environment needed, so
// this stays on Vitest's default "node" environment rather than pulling in
// jsdom as a dependency.
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path mapping — Vitest
    // doesn't read tsconfig paths on its own, and some modules (e.g.
    // blobStorage/index.ts) import via the alias rather than a relative
    // path.
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
