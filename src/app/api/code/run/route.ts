import { runCppTests } from "@/lib/code/cppRunner";
import { runCSharpTests } from "@/lib/code/csharpRunner";
import { runSqlTests } from "@/lib/code/sqlRunner";
import { parseRunRequest, isLocalRequest } from "@/lib/code/runRequest";
import { parseJsonObjectBody } from "@/lib/requestBody";

// Compiles and runs C++, C# and SQL exercises on this computer (see
// lib/code/sandbox.ts — sandboxed). Body: { language: "cpp" | "csharp" | "sql", code,
// tests: [{ name, code }], setup? (SQL) }.
// Returns the same shape the in-browser runner produces.
//
// This executes code, so it only answers requests from the app's own page
// on localhost: a web page on another site must not be able to make a
// visitor's browser start compiles here.
export async function POST(request: Request) {
  if (!isLocalRequest(request.headers)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const run = parseRunRequest(await parseJsonObjectBody(request));
  if (!run) return Response.json({ error: "Invalid run request" }, { status: 400 });
  try {
    const result =
      run.language === "sql"
        ? await runSqlTests(run.code, run.tests, run.setup)
        : run.language === "csharp"
          ? await runCSharpTests(run.files ?? run.code, run.tests)
          : await runCppTests(run.files ?? run.code, run.tests);
    return Response.json({ result });
  } catch (err) {
    console.error("Running code failed:", err);
    return Response.json({ error: "The code couldn't be run" }, { status: 500 });
  }
}
