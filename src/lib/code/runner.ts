import type { CodeLanguage, CodeTest, RunResult, TestOutcome } from "./types";
import { PYODIDE_URL, workerSource } from "./workerSource";

// Runs code and tests in the browser, never on the server.
//
// Where: a hidden <iframe sandbox="allow-scripts"> made from srcdoc, so it
// has no origin of its own — code in it can't use the app's cookies or call
// its API — with a Content-Security-Policy that blocks every network
// request except loading Pyodide from its CDN. Inside the frame, code runs
// in a Web Worker (workerSource.ts), so an endless loop can't freeze the
// page: when a run takes too long, the whole frame is thrown away and a
// fresh one made next time. JavaScript gets a fresh worker per run; Python
// keeps one alive so Pyodide only loads once per frame.

const RUN_TIMEOUT_MS = 8000;
const PYODIDE_LOAD_TIMEOUT_MS = 90_000;

export const SANDBOX_CSP = [
  "default-src 'none'",
  // Pyodide compiles WebAssembly and evaluates JavaScript glue.
  `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${PYODIDE_URL}`,
  "worker-src blob:",
  `connect-src ${PYODIDE_URL}`,
].join("; ");

// The frame's page: relays runs from the app to the right worker and
// results back. Pure, so it's testable.
export function sandboxDocument(): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<script>
"use strict";
const url = URL.createObjectURL(new Blob([${JSON.stringify(workerSource()).replace(/</g, "\\u003c")}], { type: "text/javascript" }));
let python = null;
function start(language, id) {
  const worker = new Worker(url);
  worker.onmessage = (event) => {
    parent.postMessage(event.data, "*");
    if (language === "javascript" && !event.data.loaded) worker.terminate();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    parent.postMessage({ id, failure: event.message || "The code couldn't run." }, "*");
    if (language === "python") python = null;
  };
  return worker;
}
addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const run = event.data;
  const worker = run.language === "python" ? (python ??= start("python", run.id)) : start("javascript", run.id);
  worker.postMessage(run);
});
parent.postMessage({ ready: true }, "*");
</script>`;
}

interface Pending {
  resolve: (r: RunResult) => void;
  timer: ReturnType<typeof setTimeout>;
  tests: CodeTest[];
  language: CodeLanguage;
}

let frame: HTMLIFrameElement | null = null;
let frameReady: Promise<void> | null = null;
let pythonReady = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function failed(message: string, tests: CodeTest[]): RunResult {
  return { stdout: "", error: message, tests: tests.map((t) => ({ name: t.name, passed: false, message })) };
}

function onMessage(event: MessageEvent) {
  if (!frame || event.source !== frame.contentWindow) return;
  const { id, result, failure, loaded } = (event.data ?? {}) as {
    id?: number;
    result?: RunResult;
    failure?: string;
    loaded?: boolean;
  };
  const entry = id === undefined ? undefined : pending.get(id);
  if (loaded) {
    pythonReady = true;
    // Loading done: the run itself now gets the normal time limit.
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => timeOut(id!), RUN_TIMEOUT_MS);
    }
    return;
  }
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id!);
  entry.resolve(result ?? failed(failure ?? "The code couldn't run.", entry.tests));
}

function ensureFrame(): Promise<void> {
  if (frame && frameReady) return frameReady;
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  iframe.hidden = true;
  iframe.setAttribute("aria-hidden", "true");
  iframe.srcdoc = sandboxDocument();
  frame = iframe;
  frameReady = new Promise<void>((resolve) => {
    const ready = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || !(event.data as { ready?: boolean })?.ready) return;
      window.removeEventListener("message", ready);
      resolve();
    };
    window.addEventListener("message", ready);
  });
  window.addEventListener("message", onMessage);
  document.body.appendChild(iframe);
  return frameReady;
}

// Throws the frame away — and with it every worker and pending run.
function discardFrame(message: string) {
  frame?.remove();
  frame = null;
  frameReady = null;
  pythonReady = false;
  window.removeEventListener("message", onMessage);
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(failed(message, entry.tests));
  }
}

function timeOut(id: number) {
  const entry = pending.get(id);
  if (!entry) return;
  discardFrame(
    entry.language === "python" && !pythonReady
      ? "Python couldn't load — check your internet connection and try again."
      : `Stopped after ${RUN_TIMEOUT_MS / 1000} seconds — is there an endless loop?`
  );
}

export async function runTests(language: CodeLanguage, code: string, tests: CodeTest[]): Promise<RunResult> {
  if (typeof window === "undefined" || typeof Worker === "undefined") return failed("Code can't run here.", tests);
  await ensureFrame();
  const id = nextId++;
  const limit = language === "python" && !pythonReady ? PYODIDE_LOAD_TIMEOUT_MS : RUN_TIMEOUT_MS;
  return new Promise<RunResult>((resolve) => {
    pending.set(id, { resolve, tests, language, timer: setTimeout(() => timeOut(id), limit) });
    frame!.contentWindow!.postMessage({ id, language, code, tests: tests.map(({ name, code }) => ({ name, code })) }, "*");
  });
}

// Whether Python has already loaded — the first run downloads it.
export function pythonLoaded(): boolean {
  return pythonReady;
}

// Tests the reference solution itself fails are broken: the AI got them
// wrong. They're left out of the learner's results rather than failing them.
export function brokenTestNames(solutionRun: RunResult): Set<string> {
  if (solutionRun.error !== null) return new Set();
  return new Set(solutionRun.tests.filter((t) => !t.passed).map((t) => t.name));
}

export function withoutBroken(outcomes: TestOutcome[], broken: Set<string>): TestOutcome[] {
  return outcomes.filter((t) => !broken.has(t.name));
}
