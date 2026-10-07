import { describe, expect, it } from "vitest";
import { buildCSharpHarness, explainCSharpError, formatCSharpDiagnostics, parseCSharpDiagnostics } from "./csharpHarness";

describe("buildCSharpHarness", () => {
  it("wraps each test as its own method with its own line numbers, and dispatches by index", () => {
    const src = buildCSharpHarness([
      { index: 0, code: "CheckEqual(1, 1);" },
      { index: 3, code: "CheckTrue(true);" },
    ]);
    expect(src).toContain('#line 1 "test_3.cs"');
    expect(src).toContain("static void Test3() { CheckTrue(true);");
    expect(src).toContain("case 3: Test3(); break;");
    // The helpers are imported statically, so a learner's class can't shadow them.
    expect(src).toContain("using static SbHelpers;");
    expect(src).not.toContain("__NO_MAIN__");
  });
});

describe("parseCSharpDiagnostics", () => {
  const output = `your_code.cs(2,32): error CS0103: The name 'x' does not exist in the current context [/work/prog.csproj]
your_code.cs(5,13): warning CS0219: The variable 'unused' is assigned but its value is never used
test_1.cs(1,5): error CS0117: 'A' does not contain a definition for 'Missing'
Build FAILED.`;
  it("reads file, line, severity and code from each diagnostic", () => {
    const list = parseCSharpDiagnostics(output);
    expect(list.map((d) => [d.file, d.line, d.severity, d.code])).toEqual([
      ["your_code.cs", 2, "error", "CS0103"],
      ["your_code.cs", 5, "warning", "CS0219"],
      ["test_1.cs", 1, "error", "CS0117"],
    ]);
  });

  it("formats them without the build's own file path", () => {
    const text = formatCSharpDiagnostics(parseCSharpDiagnostics(output).slice(0, 1));
    expect(text).toBe("your_code.cs(2,32): error CS0103: The name 'x' does not exist in the current context");
  });

  it("explains the top-level statements clash, and nothing else", () => {
    expect(explainCSharpError([{ file: "a", line: 1, severity: "error", code: "CS8804", text: "" }])).toMatch(/Top-level statements/);
    expect(explainCSharpError(parseCSharpDiagnostics(output))).toBeNull();
  });
});
