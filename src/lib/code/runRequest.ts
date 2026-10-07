// Parsing and origin checks for the route that runs code on this machine.
// Pure.

import { parseProjectFiles } from "./projectFiles";
import type { ProjectFile } from "./types";

const MAX_CODE_CHARS = 50_000;
const MAX_TESTS = 20;
const MAX_TEST_CODE_CHARS = 8_000;

export type ServerLanguage = "cpp" | "csharp" | "sql";

export interface RunRequest {
  language: ServerLanguage;
  // SQL: the exercise's schema and data, run before the learner's SQL.
  setup: string;
  code: string;
  // A multi-file project's files, run instead of `code` (C++ and C# only).
  files: ProjectFile[] | null;
  tests: { name: string; code: string }[];
}

export function parseRunRequest(body: Record<string, unknown>): RunRequest | null {
  if (body.language !== "cpp" && body.language !== "csharp" && body.language !== "sql") return null;
  const setup = body.setup === undefined ? "" : body.setup;
  if (typeof setup !== "string" || setup.length > MAX_CODE_CHARS) return null;
  let files: ProjectFile[] | null = null;
  if (body.files !== undefined) {
    if (body.language === "sql") return null;
    files = parseProjectFiles(body.language, body.files);
    if (!files) return null;
  }
  // With files the code is unused, so it may be missing.
  const code = body.code === undefined && files ? "" : body.code;
  if (typeof code !== "string" || code.length > MAX_CODE_CHARS) return null;
  if (!Array.isArray(body.tests) || body.tests.length > MAX_TESTS) return null;
  const tests: RunRequest["tests"] = [];
  for (const t of body.tests) {
    if (!t || typeof t !== "object") return null;
    const { name, code } = t as Record<string, unknown>;
    if (typeof name !== "string" || typeof code !== "string" || code.length > MAX_TEST_CODE_CHARS) return null;
    tests.push({ name: name.slice(0, 120), code });
  }
  return { language: body.language, setup, code, files, tests };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(hostOrOrigin: string): string | null {
  try {
    return new URL(hostOrOrigin.includes("://") ? hostOrOrigin : `http://${hostOrOrigin}`).hostname;
  } catch {
    return null;
  }
}

// Same-origin requests to a localhost host only: the Host header must name
// this machine (which also blocks DNS rebinding), a JSON content type rules
// out a cross-site form post, and any Origin must be the same host.
export function isLocalRequest(headers: Headers): boolean {
  const host = headers.get("host");
  const hostName = host ? hostnameOf(host) : null;
  if (!host || !hostName || !LOCAL_HOSTS.has(hostName)) return false;
  if (!(headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return false;
  const origin = headers.get("origin");
  if (origin !== null) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
