import * as fs from "fs";
import * as path from "path";
import { RejectedJob } from "../types";
import { DATA_DIR, sanitizeFileName } from "./paths";

export function rejectedFileFor(profileName: string): string {
  return path.join(
    DATA_DIR,
    `rejected-jobs-seek-${sanitizeFileName(profileName)}.json`,
  );
}

export function loadRejectedJobs(file: string): RejectedJob[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

export function saveRejectedJobs(jobs: RejectedJob[], file: string): void {
  fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
}
