import { JS_HARNESS_SOURCE } from "./jsHarness";
import { PACKAGE_DISCOVERY, PACKAGE_WARMUP, PYTHON_HARNESS } from "./pythonHarness";

// Pyodide (CPython compiled to WebAssembly), loaded from the jsDelivr CDN
// the first time Python code runs. The 0.29 line: later versions only load
// in module workers, which can't start inside the runner's sandbox
// (runner.ts), where the page has no origin of its own.
export const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

// The source of the Web Worker the code runs in, inside the runner's
// sandboxed frame (runner.ts). The frame is what keeps code away from the
// app and the network: no origin of its own, and a Content-Security-Policy
// that only allows the Pyodide CDN. On top of that, before any learner or
// test code runs, the worker also drops its network and storage APIs. For
// Python that happens once Pyodide has loaded — it needs them for that —
// and is lifted only for as long as a run's packages (numpy, matplotlib,
// sympy, …) take to download, by code in the worker's own closure that
// learner code has no way to reach.
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
// Everything from here on sits inside one function: a top-level const in a
// classic worker script is still visible by name to code evaluated later
// (Python's run_js, say), and the network handle below must not be.
(() => {
// What Python runs need before their code does: the packages it imports
// (downloaded, then imported once so a slow first import doesn't count
// against the run's time limit), and a drawing backend for matplotlib that
// works without a page.
const PACKAGE_DISCOVERY = ${JSON.stringify(PACKAGE_DISCOVERY)};
const PACKAGE_WARMUP = ${JSON.stringify(PACKAGE_WARMUP)};
const pythonNetwork = (() => {
  const real = {};
  for (const name of BLOCKED) real[name] = self[name];
  const define = (name, descriptor) => { try { Object.defineProperty(self, name, descriptor); } catch (e) {} };
  return {
    block() { for (const name of BLOCKED) define(name, { value: undefined, configurable: true, writable: false }); },
    allow() { for (const name of BLOCKED) define(name, { value: real[name], configurable: true, writable: true }); },
  };
})();
let pyodide = null;
async function preparePackages(id, sources) {
  self.postMessage({ id, loading: true });
  pythonNetwork.allow();
  try {
    const globals = pyodide.globals.get("dict")();
    globals.set("__sources_json", JSON.stringify(sources));
    let names;
    try {
      names = JSON.parse(await pyodide.runPythonAsync(PACKAGE_DISCOVERY, { globals }));
    } finally {
      globals.destroy();
    }
    const quiet = { messageCallback: () => {}, errorCallback: () => {} };
    for (const source of sources) {
      try { await pyodide.loadPackagesFromImports(source, quiet); } catch (e) { if (!/SyntaxError/.test(String(e))) throw e; }
    }
    const warm = pyodide.globals.get("dict")();
    warm.set("__names_json", JSON.stringify(names));
    try {
      await pyodide.runPythonAsync(PACKAGE_WARMUP, { globals: warm });
    } finally {
      warm.destroy();
    }
  } finally {
    pythonNetwork.block();
  }
  self.postMessage({ id, loaded: true });
}
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
      pythonNetwork.block();
      self.postMessage({ id, loaded: true });
    }
    try {
      await preparePackages(id, [code, ...tests.map((t) => t.code)]);
    } catch (err) {
      self.postMessage({ id, failure: "A Python package this code uses couldn't be loaded — check your internet connection and try again." });
      return;
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
})();
`;
}
