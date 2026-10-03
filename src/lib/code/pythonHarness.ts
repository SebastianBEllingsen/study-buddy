// Run before a Python run, with `__sources_json` (the learner's code and the
// tests) set: which modules they import, as a JSON list of top-level names.
export const PACKAGE_DISCOVERY = `
import json
from pyodide.code import find_imports
__found = []
for __source in json.loads(__sources_json):
    try:
        __found += find_imports(__source)
    except SyntaxError:
        pass
json.dumps(sorted(set(__found)))
`;

// Run once those packages have downloaded, with `__names_json` set: imports
// them now (matplotlib's first import builds its font cache, which is slow),
// and points matplotlib at a backend that draws without a page.
export const PACKAGE_WARMUP = `
import importlib, json, os
os.environ["MPLBACKEND"] = "AGG"
__names = json.loads(__names_json)
for __name in __names:
    try:
        importlib.import_module(__name)
    except BaseException:
        pass
if "matplotlib" in __names:
    try:
        import matplotlib.pyplot as __plt
        __plt.show = lambda *args, **kwargs: None
    except BaseException:
        pass
`;

// The Python side of the test runner, run by Pyodide inside the worker
// (see workerSource.ts) with `__user_code` and `__tests_json` set in its
// globals. Mirrors jsHarness.ts: the learner's code runs once on its own,
// then each test runs against a fresh copy of the resulting namespace. The
// final expression — the JSON result — is what runPythonAsync returns.
export const PYTHON_HARNESS = `
import sys, io, json, builtins, base64

def __no_input(*_args):
    raise RuntimeError("input() isn't available here - pass values to your function as arguments instead.")

builtins.input = __no_input

def __describe(e):
    line = None
    tb = e.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "your_code.py":
            line = tb.tb_lineno
        tb = tb.tb_next
    if isinstance(e, SyntaxError) and e.filename == "your_code.py":
        line = e.lineno
    text = f"{type(e).__name__}: {e}"
    return f"{text} (line {line} of your code)" if line else text

__tests = json.loads(__tests_json)
__out = io.StringIO()
__real_stdout = sys.stdout
__ns = {"__name__": "__main__"}
__error = None
sys.stdout = __out
try:
    exec(compile(__user_code, "your_code.py", "exec"), __ns)
except BaseException as e:
    __error = __describe(e)
finally:
    sys.stdout = __real_stdout

# Figures the learner's code drew (matplotlib), as PNG data URLs — at most a
# few, none of them huge.
__images = []
if "matplotlib.pyplot" in sys.modules:
    try:
        import matplotlib.pyplot as __plt
        for __number in __plt.get_fignums()[:6]:
            __buffer = io.BytesIO()
            __plt.figure(__number).savefig(__buffer, format="png", dpi=90, bbox_inches="tight")
            __png = base64.b64encode(__buffer.getvalue()).decode()
            if len(__png) <= 600000:
                __images.append("data:image/png;base64," + __png)
        __plt.close("all")
    except BaseException:
        pass

__results = []
for __t in __tests:
    if __error is not None:
        __results.append({"name": __t["name"], "passed": False, "message": "Your code didn't run: " + __error})
        continue
    sys.stdout = io.StringIO()
    try:
        exec(compile(__t["code"], "test.py", "exec"), dict(__ns))
        __results.append({"name": __t["name"], "passed": True, "message": None})
    except AssertionError as e:
        __results.append({"name": __t["name"], "passed": False, "message": str(e) or "An assertion failed"})
    except BaseException as e:
        __results.append({"name": __t["name"], "passed": False, "message": __describe(e)})
    finally:
        sys.stdout = __real_stdout

json.dumps({"stdout": __out.getvalue()[:20000], "error": __error, "tests": __results, "images": __images})
`;
