import * as fs from "fs";
import * as path from "path";
import { AppConfig, DeliveryConfig, Profile } from "./types";

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

export function parseDeliveryConfig(
  raw: any,
  profileName: string,
): DeliveryConfig {
  const mode = raw?.mode === "digest" ? "digest" : "realtime";
  const digestTimes: string[] = Array.isArray(raw?.digestTimes)
    ? raw.digestTimes
        .map((t: unknown) => String(t).trim())
        .filter((t: string) => /^\d{2}:\d{2}$/.test(t))
    : [];

  if (mode === "digest" && digestTimes.length === 0) {
    console.log(
      `⚠️  Profile "${profileName}" has delivery.mode="digest" but no valid digestTimes (expected "HH:mm"); falling back to realtime.`,
    );
    return { mode: "realtime", digestTimes: [] };
  }

  return { mode, digestTimes };
}

export function loadConfig(): AppConfig {
  const emailUser = process.env.EMAIL_USER ?? "";
  const emailAppPassword = process.env.EMAIL_APP_PASSWORD ?? "";

  if (!emailUser || emailUser === "yourname@gmail.com") {
    console.error("❌ Set EMAIL_USER in .env");
    process.exit(1);
  }
  if (!emailAppPassword || emailAppPassword.includes("xxxx")) {
    console.error("❌ Set EMAIL_APP_PASSWORD in .env");
    process.exit(1);
  }

  const configPath = path.resolve(
    __dirname,
    "..",
    process.env.CONFIG_PATH ?? "config.json",
  );

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`❌ Failed to read config file at ${configPath}:`, err);
    process.exit(1);
  }

  const profiles: Profile[] = (raw.profiles ?? [])
    .map((p: any) => ({
      name: String(p.name ?? "").trim(),
      emailTo: String(p.emailTo ?? "").trim(),
      emailSubjectPrefix: p.emailSubjectPrefix
        ? String(p.emailSubjectPrefix).trim()
        : undefined,
      seekUrls: (p.seekUrls ?? [])
        .map((u: string) => u.trim())
        .filter(Boolean),
      seekCheckIntervalMs: (p.seekCheckIntervalMinutes ?? 30) * 60 * 1000,
      titleExcludeKeywords: (p.titleExcludeKeywords ?? [])
        .map((k: string) => String(k).trim())
        .filter(Boolean),
      aiFilter: p.aiFilter
        ? {
            enabled: Boolean(p.aiFilter.enabled),
            model: p.aiFilter.model,
            unwantedCriteria: p.aiFilter.unwantedCriteria ?? [],
          }
        : undefined,
      delivery: parseDeliveryConfig(p.delivery, String(p.name ?? "")),
    }))
    .filter((p: Profile) => {
      if (!p.name || !p.emailTo) {
        console.error(
          "❌ Each profile needs 'name' and 'emailTo'; skipping invalid entry.",
        );
        return false;
      }
      if (p.seekUrls.length === 0) {
        console.log(`⚠️  Profile "${p.name}" has no seekUrls, skipping.`);
        return false;
      }
      return true;
    });

  if (profiles.length === 0) {
    console.error("❌ No valid profile with seekUrls found in config.json");
    process.exit(1);
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const needsAi = profiles.some((p) => p.aiFilter?.enabled);
  if (needsAi && !anthropicApiKey) {
    console.warn(
      "⚠️  Some profiles have aiFilter.enabled=true but ANTHROPIC_API_KEY is missing in .env — AI filtering will be skipped for them.",
    );
  }

  return { smtp: { emailUser, emailAppPassword }, anthropicApiKey, profiles };
}
