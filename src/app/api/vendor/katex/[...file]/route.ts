import fs from "node:fs/promises";
import path from "node:path";

// Serves KaTeX's own build (stylesheet, script, auto-render, fonts) from
// node_modules, so a card imported from Anki can typeset its \(…\) math
// inside its sandboxed frame without any network access. Only these file
// types, only inside katex/dist.
const distDir = path.join(process.cwd(), "node_modules", "katex", "dist");

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

type Params = { params: Promise<{ file: string[] }> };

export async function GET(_request: Request, { params }: Params) {
  const { file } = await params;
  if (file.length === 0 || file.some((s) => s === ".." || s === "." || s.includes("\\") || s.includes("\0"))) {
    return new Response(null, { status: 400 });
  }
  const filePath = path.join(distDir, ...file);
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!contentType || !filePath.startsWith(distDir + path.sep)) return new Response(null, { status: 404 });
  try {
    const bytes = await fs.readFile(filePath);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
