import { DEFAULT_CLAUDE_MODEL } from "./config";
import { classifyJobWithClaude } from "./aiFilter";
import { saveRejectedJobs } from "./persistence/rejectedJobs";
import { saveSeenIds } from "./persistence/seenJobs";
import { fetchJobDescriptionsForNewJobs, fetchSeekJobs } from "./seekFetcher";
import { AiFilterConfig, EmailGroup, Job, RejectedJob } from "./types";

export async function checkOnce(
  urls: string[],
  seenFile: string,
  rejectedFile: string,
  seenIds: Set<string>,
  rejectedIds: Set<string>,
  rejectedJobs: RejectedJob[],
  titleExcludeKeywords: string[] | undefined,
  aiFilter: AiFilterConfig | undefined,
  anthropicApiKey: string | undefined,
): Promise<EmailGroup[]> {
  const groups: EmailGroup[] = [];

  for (const url of urls) {
    const label = decodeURIComponent(
      url.replace("https://au.seek.com/", "").replace(/\//g, " › "),
    );

    console.log(`🔍 [SEEK] Checking: ${label}`);

    const jobs = await fetchSeekJobs(url);
    console.log(`   Found ${jobs.length} jobs`);

    // 去重要同时排除"已推送"和"已被过滤（关键词/AI）"两个列表
    const newJobs = jobs.filter(
      (job) => job.id && !seenIds.has(job.id) && !rejectedIds.has(job.id),
    );

    // 第一步：标题关键词粗筛（大小写不敏感的模糊匹配），命中直接排除，不进 AI
    let remainingJobs: Job[] = newJobs;
    let keywordRejectedThisRun = 0;
    if (
      titleExcludeKeywords &&
      titleExcludeKeywords.length > 0 &&
      newJobs.length > 0
    ) {
      const lowerKeywords = titleExcludeKeywords.map((k) => k.toLowerCase());
      remainingJobs = [];
      for (const job of newJobs) {
        const titleLower = job.title.toLowerCase();
        const matched = lowerKeywords.find((k) => titleLower.includes(k));
        if (matched) {
          console.log(
            `🚫 [Keyword] Excluded "${job.title}": matched "${matched}"`,
          );
          rejectedJobs.push({
            ...job,
            reason: `职位名命中排除关键词: "${matched}"`,
            filteredBy: "keyword",
            rejectedAt: new Date().toISOString(),
          });
          rejectedIds.add(job.id);
          keywordRejectedThisRun++;
        } else {
          remainingJobs.push(job);
        }
      }
      if (keywordRejectedThisRun > 0)
        saveRejectedJobs(rejectedJobs, rejectedFile);
    }

    // 第二步：AI 过滤（只处理关键词筛过之后剩下的职位）
    let jobsToSend: Job[] = remainingJobs;
    let aiRejectedThisRun = 0;

    if (aiFilter?.enabled && remainingJobs.length > 0) {
      if (!anthropicApiKey) {
        console.error(
          "⚠️  aiFilter.enabled=true but ANTHROPIC_API_KEY missing; sending without AI filtering.",
        );
      } else {
        jobsToSend = [];
        const descriptions =
          await fetchJobDescriptionsForNewJobs(remainingJobs);
        for (const job of remainingJobs) {
          try {
            const result = await classifyJobWithClaude(
              anthropicApiKey,
              aiFilter.model ?? DEFAULT_CLAUDE_MODEL,
              aiFilter.unwantedCriteria,
              job,
              descriptions.get(job.id) ?? "",
            );
            if (result.reject) {
              console.log(`🚫 [AI] Rejected "${job.title}": ${result.reason}`);
              rejectedJobs.push({
                ...job,
                reason: result.reason,
                filteredBy: "ai",
                rejectedAt: new Date().toISOString(),
              });
              rejectedIds.add(job.id);
              aiRejectedThisRun++;
            } else {
              jobsToSend.push(job);
            }
          } catch (err) {
            console.error(
              `❌ [AI] Classify failed for "${job.title}", sending without filtering:`,
              err,
            );
            jobsToSend.push(job);
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (aiRejectedThisRun > 0)
          saveRejectedJobs(rejectedJobs, rejectedFile);
      }
    }

    for (const job of jobsToSend) seenIds.add(job.id);

    if (jobsToSend.length > 0) {
      groups.push({ label, jobs: jobsToSend });
      console.log(
        `✅ ${jobsToSend.length} job(s) queued to send (${keywordRejectedThisRun} by keyword, ${aiRejectedThisRun} by AI filtered out).`,
      );
    } else if (newJobs.length > 0) {
      console.log(
        `✅ ${newJobs.length} new job(s) found, all filtered out (${keywordRejectedThisRun} by keyword, ${aiRejectedThisRun} by AI).`,
      );
    } else {
      console.log("✅ No new jobs for this search.");
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  saveSeenIds(seenIds, seenFile);
  return groups;
}
