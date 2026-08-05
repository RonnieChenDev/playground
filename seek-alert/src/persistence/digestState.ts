import * as fs from "fs";
import * as path from "path";
import { DigestState } from "../types";
import { DATA_DIR, sanitizeFileName } from "./paths";

export function digestStateFileFor(profileName: string): string {
  return path.join(
    DATA_DIR,
    `digest-state-seek-${sanitizeFileName(profileName)}.json`,
  );
}

export function loadDigestState(file: string): DigestState {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (data && typeof data.date === "string" && Array.isArray(data.firedTimes)) {
      return data;
    }
  } catch {
    // ignore, fall through to default
  }
  return { date: "", firedTimes: [] };
}

export function saveDigestState(state: DigestState, file: string): void {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
