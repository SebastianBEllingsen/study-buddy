import { describe, expect, it } from "vitest";
import { csharpToolchainAvailable, runCSharpTests } from "./csharpRunner";

// These really compile and run C# through the sandbox, so they need the
// .NET SDK and bubblewrap — skipped on a machine without them.
const available = csharpToolchainAvailable();
const t = (name: string, code: string) => ({ name, code });
const TIMEOUT = 90_000;

describe.skipIf(!available)("runCSharpTests", () => {
  it("passes and fails individual tests with readable messages", async () => {
    const result = await runCSharpTests("public static class Calc { public static int Add(int a, int b) => a + b; }", [
      t("adds", "CheckEqual(Calc.Add(2, 3), 5);"),
      t("wrong expectation", "CheckEqual(Calc.Add(2, 3), 6);"),
      t("lists compare by value", "CheckEqual(new List<int> { 1, 2 }, new[] { 1, 3 });"),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests.map((x) => x.passed)).toEqual([true, false, false]);
    expect(result.tests[1].message).toContain("expected 6, got 5");
    expect(result.tests[2].message).toContain("expected [1, 3], got [1, 2]");
  }, TIMEOUT);

  it("reports a compile error in the learner's code with their own line number", async () => {
    const result = await runCSharpTests("public static class A {\n  public static int F() { return x; }\n}", [t("a", "CheckEqual(A.F(), 1);")]);
    expect(result.error).toMatch(/your_code\.cs\(2,\d+\): error CS0103/);
    expect(result.error).not.toContain("/work");
    expect(result.tests[0].passed).toBe(false);
  }, TIMEOUT);

  it("keeps a test that can't be built from failing the others", async () => {
    const result = await runCSharpTests("public static class A { public static int One() => 1; }", [
      t("good", "CheckEqual(A.One(), 1);"),
      t("calls something undefined", "CheckEqual(A.Missing(), 1);"),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests[0].passed).toBe(true);
    expect(result.tests[1].passed).toBe(false);
    expect(result.tests[1].message).toMatch(/couldn't be built.*Missing/);
  }, TIMEOUT);

  it("reports exceptions, endless loops and stack overflows per test", async () => {
    const code = `public static class A {
  public static int Boom(int[] xs) => xs[5];
  public static void Spin() { while (true) {} }
  public static int Deep(int n) => Deep(n + 1) + 1;
  public static int Ok() => 1;
}`;
    const result = await runCSharpTests(code, [
      t("index", "A.Boom(new int[2]);"),
      t("spin", "A.Spin();"),
      t("deep", "A.Deep(0);"),
      t("fine", "CheckEqual(A.Ok(), 1);"),
    ]);
    expect(result.tests[0].message).toMatch(/IndexOutOfRangeException/);
    expect(result.tests[1].message).toMatch(/endless loop/);
    expect(result.tests[2].message).toMatch(/Stack overflow/);
    expect(result.tests[3].passed).toBe(true);
  }, TIMEOUT);

  it("runs a program that reads input and prints, and captures its output", async () => {
    const code = `using System;
public static class Program {
  public static void Main() { var n = int.Parse(Console.ReadLine()!); Console.WriteLine(n * 2); }
}`;
    const result = await runCSharpTests(code, [t("doubles", 'CheckEqual(RunMain("21\\n").Trim(), "42");')]);
    expect(result.error).toBeNull();
    expect(result.tests[0]).toEqual({ name: "doubles", passed: true, message: null });
  }, TIMEOUT);

  it("runs top-level statements as a program, too", async () => {
    const result = await runCSharpTests('System.Console.WriteLine("hi");', [t("prints", 'CheckEqual(RunMain().Trim(), "hi");')]);
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("hi");
    expect(result.tests[0]).toEqual({ name: "prints", passed: true, message: null });
  }, TIMEOUT);

  it("warns about problems in the learner's code that still compile", async () => {
    const result = await runCSharpTests("public static class A { public static int F() { int unused = 1; return 2; } }", [t("f", "CheckEqual(A.F(), 2);")]);
    expect(result.tests[0].passed).toBe(true);
    expect(result.diagnostics).toMatch(/CS0219/);
  }, TIMEOUT);

  it("is sandboxed: no host files and no network", async () => {
    const code = `using System.IO;
using System.Net.Sockets;
public static class A {
  public static bool Exists(string p) => File.Exists(p) || Directory.Exists(p);
  public static bool CanConnect() { try { using var c = new TcpClient(); c.Connect("1.1.1.1", 80); return true; } catch { return false; } }
}`;
    const result = await runCSharpTests(code, [
      t("host /etc/passwd is invisible", 'CheckTrue(!A.Exists("/etc/passwd"));'),
      t("host home is invisible", 'CheckTrue(!A.Exists("/home"));'),
      t("no network", "CheckTrue(!A.CanConnect());"),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests.map((x) => x.message)).toEqual([null, null, null]);
  }, TIMEOUT);

  it("builds a project of several files together", async () => {
    const files = [
      { name: "Counter.cs", content: "public class Counter { public int Value { get; private set; } public void Increment() => Value++; }" },
      { name: "Program.cs", content: 'using System;\npublic static class Program { public static void Main() { var c = new Counter(); c.Increment(); Console.WriteLine(c.Value); } }' },
    ];
    const result = await runCSharpTests(files, [
      t("counts", "var c = new Counter(); c.Increment(); c.Increment(); CheckEqual(c.Value, 2);"),
      t("main", 'CheckEqual(RunMain().Trim(), "1");'),
    ]);
    expect(result.error).toBeNull();
    expect(result.tests.map((x) => x.passed)).toEqual([true, true]);

    const broken = await runCSharpTests([files[0], { ...files[1], name: "Program.cs", content: "public static class Program { public static void Main() { Nope(); } }" }], [t("a", "CheckTrue(true);")]);
    expect(broken.error).toMatch(/Program\.cs\(1,\d+\): error CS0103/);
  }, TIMEOUT);
});

