import { JS_HARNESS_SOURCE } from "./jsHarness";
import { PYTHON_HARNESS } from "./pythonHarness";

// Pyodide (CPython compiled to WebAssembly), loaded from the jsDelivr CDN
// the first time Python code runs. The 0.29 line: later versions only load
// in module workers, which can't start inside the runner's sandbox
// (runner.ts), where the page has no origin of its own.
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

// The source of the Web Worker the code runs in, inside the runner's
// sandboxed frame (runner.ts). The frame is what keeps code away from the
// app and the network: no origin of its own, and a Content-Security-Policy
// that only allows the Pyodide CDN. On top of that, before any learner or
// test code runs, the worker also drops its network and storage APIs (for
// Python, once Pyodide itself has loaded — it needs them for that).
export function workerSource(): string {
  return `"use strict";
${JS_HARNESS_SOURCE}
const PYTHON_HARNESS = ${JSON.stringify(PYTHON_HARNESS)};
const BLOCKED = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "Worker", "SharedWorker", "BroadcastChannel", "WebTransport"];
function lockDown() {
  for (const name of BLOCKED) {
    try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch (e) {}
  }
}
let pyodide = null;
self.onmessage = async (event) => {
  const { id, language, code, tests } = event.data;
  try {
    if (language === "javascript") {
      lockDown();
      self.postMessage({ id, result: runJavaScriptTests(code, tests) });
      return;
    }
    if (!pyodide) {
      importScripts(${JSON.stringify(PYODIDE_URL)} + "pyodide.js");
      pyodide = await loadPyodide({ indexURL: ${JSON.stringify(PYODIDE_URL)} });
      pyodide.setStdin({ stdin: () => { throw new Error("input() isn't available here — pass values as arguments instead."); } });
      lockDown();
      self.postMessage({ id, loaded: true });
    }
    const globals = pyodide.globals.get("dict")();
    globals.set("__user_code", code);
    globals.set("__tests_json", JSON.stringify(tests));
    try {
      const json = await pyodide.runPythonAsync(PYTHON_HARNESS, { globals });
      self.postMessage({ id, result: JSON.parse(json) });
    } finally {
      globals.destroy();
    }
  } catch (err) {
    self.postMessage({ id, failure: String((err && err.message) || err) });
  }
};
`;
}
