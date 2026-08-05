import "dotenv/config";
import { loadConfig } from "./config";
import { startSeekMonitor } from "./monitor";

async function main(): Promise<void> {
  const { smtp, anthropicApiKey, profiles } = loadConfig();

  for (const profile of profiles) {
    startSeekMonitor(profile, smtp, anthropicApiKey).catch((err) =>
      console.error(`❌ [SEEK:${profile.name}] monitor crashed:`, err),
    );
  }
}

main().catch(console.error);
