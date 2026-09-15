import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class LibreOfficeUnavailableError extends Error {
  constructor() {
    super(
      "LibreOffice isn't installed on this machine, so this file type can't be converted for viewing or text extraction."
    );
    this.name = "LibreOfficeUnavailableError";
  }
}

const CONVERT_TIMEOUT_MS = 60_000;

// Converts an office document (odt, pptx, ...) to PDF via a headless
// LibreOffice process — the same thing `soffice --headless --convert-to
// pdf` does on the command line. Once it's a PDF, it rides the exact same
// PdfViewer + extractPdfText pipeline already built for real PDFs, so odt/
// pptx never need their own viewer or extractor.
export async function convertToPdf(buffer: Buffer, sourceExt: string): Promise<Buffer> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sb-libreoffice-"));
  try {
    const inputPath = path.join(workDir, `input.${sourceExt}`);
    await fs.writeFile(inputPath, buffer);
    // -env:UserInstallation points each invocation at its own scratch
    // profile dir — without it, concurrent conversions share (and lock
    // contend on) the default user profile, which makes LibreOffice hang
    // or fail under any real concurrency.
    const profileDir = path.join(workDir, "profile");
    await runSoffice([
      `-env:UserInstallation=file://${profileDir}`,
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      inputPath,
    ]);
    return await fs.readFile(path.join(workDir, "input.pdf"));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

function runSoffice(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("soffice", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LibreOffice conversion timed out"));
    }, CONVERT_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new LibreOfficeUnavailableError());
      } else {
        reject(err);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`LibreOffice conversion failed (exit code ${code})`));
    });
  });
}
