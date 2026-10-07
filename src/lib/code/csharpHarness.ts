import { NO_MAIN_EXIT } from "./cppHarness";

// The C# side of code exercises (see csharpRunner.ts for how it's compiled
// and run). Pure: builds the harness file compiled next to the learner's
// code, and reads the compiler's output back. Test results use the same
// exit codes and SB_FAILURE / SB_EXCEPTION markers as the C++ harness, so
// cppHarness.classifyTestRun reads them too.

export const CSHARP_USER_FILE = "your_code.cs";
export const CSHARP_HARNESS_FILE = "harness.cs";
const FAILURE_EXIT = 3;
const EXCEPTION_EXIT = 4;

export function csharpTestFile(index: number): string {
  return `test_${index}.cs`;
}

// The helpers a test calls. They're imported with `using static`, so a
// type of the learner's can't shadow them the way a same-named class could.
const HELPERS = String.raw`
public sealed class SbFailure : Exception {
  public SbFailure(string message) : base(message) {}
}

public static class SbHelpers {
  public static string Show(object? v) {
    switch (v) {
      case null: return "null";
      case string s: return "\"" + s + "\"";
      case char c: return "'" + c + "'";
      case bool b: return b ? "true" : "false";
      case double d: return d.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
      case float f: return f.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
      case IDictionary dict: {
        var parts = new List<string>();
        foreach (DictionaryEntry e in dict) parts.Add(Show(e.Key) + ": " + Show(e.Value));
        return "{" + string.Join(", ", parts) + "}";
      }
      case IEnumerable seq: {
        var parts = new List<string>();
        foreach (var x in seq) parts.Add(Show(x));
        return "[" + string.Join(", ", parts) + "]";
      }
      default: return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) ?? "null";
    }
  }

  static bool IsIntegral(object v) => v is sbyte || v is byte || v is short || v is ushort || v is int || v is uint || v is long || v is ulong;
  static bool IsNumber(object v) => IsIntegral(v) || v is float || v is double || v is decimal;

  public static bool ValueEquals(object? a, object? b) {
    if (a is null || b is null) return a is null && b is null;
    if (a is string || b is string) return a.Equals(b);
    if (IsIntegral(a) && IsIntegral(b)) return Convert.ToDecimal(a) == Convert.ToDecimal(b);
    if (IsNumber(a) && IsNumber(b)) return Convert.ToDouble(a) == Convert.ToDouble(b);
    if (a is IDictionary da && b is IDictionary db) {
      if (da.Count != db.Count) return false;
      foreach (DictionaryEntry e in da) if (!db.Contains(e.Key) || !ValueEquals(e.Value, db[e.Key])) return false;
      return true;
    }
    if (a is IEnumerable ea && b is IEnumerable eb) {
      var la = ea.Cast<object?>().ToList();
      var lb = eb.Cast<object?>().ToList();
      return la.Count == lb.Count && la.Zip(lb, ValueEquals).All(x => x);
    }
    return a.Equals(b);
  }

  public static void CheckTrue(bool condition, string message = "", [System.Runtime.CompilerServices.CallerLineNumber] int line = 0) {
    if (!condition) throw new SbFailure((message == "" ? "CheckTrue failed" : message) + " [line " + line + " of the test]");
  }

  public static void CheckEqual(object? actual, object? expected, [System.Runtime.CompilerServices.CallerLineNumber] int line = 0) {
    if (!ValueEquals(actual, expected)) throw new SbFailure("expected " + Show(expected) + ", got " + Show(actual) + " [line " + line + " of the test]");
  }

  public static void CheckNear(double actual, double expected, double tolerance, [System.Runtime.CompilerServices.CallerLineNumber] int line = 0) {
    if (!(Math.Abs(actual - expected) <= tolerance)) throw new SbFailure("expected " + Show(expected) + " (within " + Show(tolerance) + "), got " + Show(actual) + " [line " + line + " of the test]");
  }

  public static void CheckThrows(Action action, [System.Runtime.CompilerServices.CallerLineNumber] int line = 0) {
    try { action(); } catch (SbFailure) { throw; } catch (Exception) { return; }
    throw new SbFailure("expected an exception, but none was thrown [line " + line + " of the test]");
  }

  // Runs action with Console.In reading from input and Console.Out captured, and returns what it printed.
  public static string Capture(Action action, string input = "") {
    var oldIn = Console.In;
    var oldOut = Console.Out;
    var writer = new StringWriter();
    Console.SetIn(new StringReader(input));
    Console.SetOut(writer);
    try { action(); } finally { Console.SetIn(oldIn); Console.SetOut(oldOut); }
    return writer.ToString();
  }

  // The learner's Main, wherever they put it (top-level statements compile to
  // a method called <Main>$); null when there isn't one.
  public static System.Reflection.MethodInfo? UserMain() =>
    typeof(SbEntry).Assembly.GetTypes()
      .Where(t => t != typeof(SbEntry) && t != typeof(SbHelpers) && t != typeof(SbFailure))
      .SelectMany(t => t.GetMethods(System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.DeclaredOnly))
      .FirstOrDefault(m => (m.Name == "Main" || m.Name == "<Main>$") && m.GetParameters().Length <= 1);

  public static int CallUserMain() {
    var main = UserMain();
    if (main == null) return __NO_MAIN__;
    object? result;
    try {
      result = main.Invoke(null, main.GetParameters().Length == 0 ? null : new object[] { new string[0] });
    } catch (System.Reflection.TargetInvocationException e) when (e.InnerException != null) {
      System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerException).Throw();
      throw;
    }
    if (result is System.Threading.Tasks.Task task) { task.GetAwaiter().GetResult(); return 0; }
    return result is int code ? code : 0;
  }

  // Runs the learner's Main with the given input and returns what it printed.
  public static string RunMain(string input = "") => Capture(() => CallUserMain(), input);
}
`;

export function buildCSharpHarness(tests: { index: number; code: string }[]): string {
  const bodies = tests
    .map(
      (t) =>
        `#line 1 "${csharpTestFile(t.index)}"\nstatic void Test${t.index}() { ${t.code}\n}\n#line default\n`
    )
    .join("");
  const table = tests.map((t) => `      case ${t.index}: Test${t.index}(); break;`).join("\n");
  return `#nullable enable
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using static SbHelpers;
${HELPERS.replace("__NO_MAIN__", String(NO_MAIN_EXIT))}
public static class SbEntry {
${bodies}
  public static int Main(string[] args) {
    if (args.Length < 2 || args[0] != "test") return CallUserMain();
    try {
      switch (int.Parse(args[1])) {
${table}
        default: return 2;
      }
      return 0;
    } catch (SbFailure f) {
      Console.Error.WriteLine("SB_FAILURE: " + f.Message);
      return ${FAILURE_EXIT};
    } catch (Exception e) {
      Console.Error.WriteLine("SB_EXCEPTION: " + e.GetType().Name + ": " + e.Message);
      return ${EXCEPTION_EXIT};
    }
  }
}
`;
}

export interface CSharpDiagnostic {
  file: string;
  line: number;
  severity: "error" | "warning";
  code: string;
  text: string;
}

// csc prints "file.cs(12,5): error CS0103: message". One per line.
export function parseCSharpDiagnostics(output: string): CSharpDiagnostic[] {
  const out: CSharpDiagnostic[] = [];
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^(.+?)\((\d+),\d+\): (error|warning) (CS\d+): (.*?)(?: \[.*\])?$/.exec(line.trim());
    if (m) out.push({ file: m[1], line: Number(m[2]), severity: m[3] as "error" | "warning", code: m[4], text: line.trim() });
  }
  return out;
}

export function formatCSharpDiagnostics(list: CSharpDiagnostic[]): string {
  return list
    .map((d) => d.text.replace(/ \[\/work[^\]]*\]$/, ""))
    .join("\n")
    .slice(0, 2500);
}

// Errors that deserve more than the compiler's own words. Top-level
// statements compile fine here, but two files of them (or them next to an
// explicit entry point the compiler is told to ignore) can still clash.
export function explainCSharpError(list: CSharpDiagnostic[]): string | null {
  if (list.some((d) => d.code === "CS8804" || d.code === "CS8805")) {
    return "Top-level statements can't be combined with this setup: put your code in a class with static methods (and `static void Main()` if it is a program).";
  }
  return null;
}
