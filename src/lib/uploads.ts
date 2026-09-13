import fs from "node:fs";
import path from "node:path";

export function uploadsDir(courseId: number): string {
  const dir = path.join(process.cwd(), "data", "uploads", String(courseId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
