import { checkOnce } from "./checkOnce";
import { DEFAULT_CLAUDE_MODEL } from "./config";
import { dispatchResults } from "./dispatchResults";
import { digestStateFileFor } from "./persistence/digestState";
import { loadRejectedJobs, rejectedFileFor } from "./persistence/rejectedJobs";
import { loadSeenIds, saveSeenIds, seenFileFor } from "./persistence/seenJobs";
import { fetchSeekJobs } from "./seekFetcher";
import { getOrCreateDigestQueueUrl } from "./sqs";
import { withTimeout } from "./time";
import { Profile, SmtpConfig } from "./types";

// 单轮检查的最长耗时；超时后放弃这一轮，保证下一轮定时检查还能继续跑
const CHECK_TIMEOUT_MS = 15 * 60 * 1000;

export async function startSeekMonitor(
  profile: Profile,
  smtp: SmtpConfig,
  anthropicApiKey: string | undefined,
): Promise<void> {
  const seenFile = seenFileFor(profile.name);
  const rejectedFile = rejectedFileFor(profile.name);
  const digestStateFile = digestStateFileFor(profile.name);
  const seenIds = loadSeenIds(seenFile);
  const rejectedJobs = loadRejectedJobs(rejectedFile);
  const rejectedIds = new Set(rejectedJobs.map((j) => j.id));
  let isChecking = false;

  let digestQueueUrl: string | undefined;
  if (profile.delivery.mode === "digest") {
    try {
      digestQueueUrl = await getOrCreateDigestQueueUrl(profile.name);
    } catch (err) {
      console.error(
        `❌ [SEEK:${profile.name}] Failed to set up SQS digest queue; falling back to realtime delivery:`,
        err,
      );
      profile.delivery = { mode: "realtime", digestTimes: [] };
    }
  }

  console.log(`🚀 SEEK Job Alert started for "${profile.name}"`);
  console.log(
    `   Monitoring ${profile.seekUrls.length} search(es), every ${profile.seekCheckIntervalMs / 60000} minutes`,
  );
  console.log(`   Alerts → ${profile.emailTo}`);
  if (profile.delivery.mode === "digest") {
    console.log(
      `   📬 Delivery: digest via SQS (${digestQueueUrl}), sent at ${profile.delivery.digestTimes.join(", ")} (Perth time)`,
    );
  } else {
    console.log(`   📬 Delivery: realtime (merged into one email per check)`);
  }
  if (profile.titleExcludeKeywords && profile.titleExcludeKeywords.length > 0) {
    console.log(
      `   🔤 Title keyword filter: ${profile.titleExcludeKeywords.join(", ")}`,
    );
  }
  if (profile.aiFilter?.enabled) {
    console.log(
      `   🤖 AI filter enabled (model: ${profile.aiFilter.model ?? DEFAULT_CLAUDE_MODEL})`,
    );
  }
  console.log(
    `   ${seenIds.size} previously seen, ${rejectedIds.size} previously rejected\n`,
  );

  if (seenIds.size === 0 && rejectedIds.size === 0) {
    console.log(
      `📝 [SEEK:${profile.name}] First run — marking existing jobs as seen (no emails sent)`,
    );
    for (const url of profile.seekUrls) {
      const jobs = await fetchSeekJobs(url);
      for (const job of jobs) {
        if (job.id) seenIds.add(job.id);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    saveSeenIds(seenIds, seenFile);
    console.log(`   Marked ${seenIds.size} existing jobs as seen.\n`);
  }

  const runCheck = async (): Promise<void> => {
    const groups = await checkOnce(
      profile.seekUrls,
      seenFile,
      rejectedFile,
      seenIds,
      rejectedIds,
      rejectedJobs,
      profile.titleExcludeKeywords,
      profile.aiFilter,
      anthropicApiKey,
    );
    await dispatchResults(profile, smtp, groups, digestQueueUrl, digestStateFile);
  };

  const safeRunCheck = async (): Promise<void> => {
    if (isChecking) {
      console.warn(
        `⚠️  [SEEK:${profile.name}] Previous check still running, skipping this one.`,
      );
      return;
    }
    isChecking = true;
    try {
      await withTimeout(runCheck(), CHECK_TIMEOUT_MS, "Scheduled check");
    } catch (err) {
      console.error(`❌ [SEEK:${profile.name}] Check failed:`, err);
    } finally {
      isChecking = false;
    }
  };

  await safeRunCheck();

  setInterval(() => {
    const now = new Date().toLocaleTimeString("en-AU", {
      timeZone: "Australia/Perth",
    });
    console.log(
      `\n⏰ [${now}] [SEEK:${profile.name}] Running scheduled check...`,
    );
    void safeRunCheck();
  }, profile.seekCheckIntervalMs);
}
