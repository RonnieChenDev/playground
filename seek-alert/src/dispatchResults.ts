import { sendJobEmail } from "./email";
import { loadDigestState, saveDigestState } from "./persistence/digestState";
import { drainPendingJobs, enqueuePendingJobs } from "./sqs";
import { perthNowParts } from "./time";
import { EmailGroup, Job, PendingJob, Profile, SmtpConfig } from "./types";

export async function dispatchResults(
  profile: Profile,
  smtp: SmtpConfig,
  groups: EmailGroup[],
  digestQueueUrl: string | undefined,
  digestStateFile: string,
): Promise<void> {
  const nonEmptyGroups = groups.filter((g) => g.jobs.length > 0);

  if (profile.delivery.mode !== "digest" || !digestQueueUrl) {
    // 实时模式（或汇总队列不可用时的兜底）：这一轮所有搜索链接的结果合并成一封邮件立刻发出
    if (nonEmptyGroups.length > 0) {
      await sendJobEmail(
        smtp,
        profile.emailTo,
        nonEmptyGroups,
        profile.emailSubjectPrefix,
      );
      const total = nonEmptyGroups.reduce((sum, g) => sum + g.jobs.length, 0);
      console.log(
        `🎉 Emailed ${total} new job(s) across ${nonEmptyGroups.length} search(es).`,
      );
    }
    return;
  }

  // 汇总模式：先把这一轮筛出来的职位塞进 SQS 队列
  if (nonEmptyGroups.length > 0) {
    const foundAt = new Date().toISOString();
    const newPending: PendingJob[] = [];
    for (const group of nonEmptyGroups) {
      for (const job of group.jobs) {
        newPending.push({ ...job, label: group.label, foundAt });
      }
    }
    try {
      await enqueuePendingJobs(digestQueueUrl, newPending);
      console.log(
        `📥 [Digest] Queued ${newPending.length} job(s) into SQS for next digest send.`,
      );
    } catch (err) {
      console.error("❌ [Digest] Failed to enqueue jobs into SQS:", err);
    }
  }

  // 再检查现在是否已经到了配置的汇总发送时间点
  const { date, time } = perthNowParts();
  let state = loadDigestState(digestStateFile);
  if (state.date !== date) {
    state = { date, firedTimes: [] };
  }

  const dueTimes = profile.delivery.digestTimes.filter(
    (t) => time >= t && !state.firedTimes.includes(t),
  );

  if (dueTimes.length > 0) {
    try {
      const pending = await drainPendingJobs(digestQueueUrl);
      if (pending.length > 0) {
        const grouped = new Map<string, Job[]>();
        for (const job of pending) {
          const list = grouped.get(job.label) ?? [];
          list.push(job);
          grouped.set(job.label, list);
        }
        const digestGroups: EmailGroup[] = [...grouped.entries()].map(
          ([label, jobs]) => ({ label, jobs }),
        );
        await sendJobEmail(
          smtp,
          profile.emailTo,
          digestGroups,
          profile.emailSubjectPrefix,
        );
        console.log(
          `🎉 [Digest] Sent ${pending.length} job(s) at ${dueTimes.join(", ")} (Perth time).`,
        );
      } else {
        console.log(
          `📭 [Digest] ${dueTimes.join(", ")} reached, but no jobs queued today.`,
        );
      }
      state.firedTimes.push(...dueTimes);
      saveDigestState(state, digestStateFile);
    } catch (err) {
      console.error(
        "❌ [Digest] Failed to drain SQS queue and send digest email (will retry next check):",
        err,
      );
    }
  }
}
