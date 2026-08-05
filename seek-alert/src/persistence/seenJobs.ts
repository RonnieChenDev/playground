import * as fs from "fs";
import * as path from "path";
import { DATA_DIR, sanitizeFileName } from "./paths";

export function seenFileFor(profileName: string): string {
  return path.join(
    DATA_DIR,
    `seen-jobs-seek-${sanitizeFileName(profileName)}.json`,
  );
}

export function loadSeenIds(file: string): Set<string> {
  try {
    const data = fs.readFileSync(file, "utf-8");
    return new Set(JSON.parse(data));
  } catch {
    return new Set();
  }
}

export function saveSeenIds(ids: Set<string>, file: string): void {
  fs.writeFileSync(file, JSON.stringify([...ids], null, 2));
}
