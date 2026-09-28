import * as fs from "fs";
import * as path from "path";
import { perthNowParts } from "../time";
import { RejectedJob } from "../types";
import { DATA_DIR, sanitizeFileName } from "./paths";

// 文件超过这个大小，或最旧一条记录超过 ROTATE_AFTER_DAYS 天，就触发归档
const ROTATE_MAX_BYTES = 1024 * 1024;
const ROTATE_AFTER_DAYS = 30;
// 归档时原文件保留最近这么多天的记录：rejected 列表同时用于去重，
// 近期被排除的职位可能还在 SEEK 搜索结果里，清空会导致它们被重新处理（重复调用 AI、可能误推）
const KEEP_RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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

// 把旧记录挪到带时间后缀的备份文件，原文件只留近期记录。
// 会原地修改 jobs 数组，因为调用方之后还会把整个数组写回原文件。
export function rotateRejectedJobs(jobs: RejectedJob[], file: string): void {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }

  const now = Date.now();
  const timestamps = jobs
    .map((j) => Date.parse(j.rejectedAt))
    .filter((t) => !Number.isNaN(t));
  const oldest = timestamps.length > 0 ? Math.min(...timestamps) : now;
  if (size < ROTATE_MAX_BYTES && now - oldest < ROTATE_AFTER_DAYS * DAY_MS) {
    return;
  }

  const cutoff = now - KEEP_RECENT_DAYS * DAY_MS;
  const isOld = (j: RejectedJob) => Date.parse(j.rejectedAt) < cutoff;
  const oldJobs = jobs.filter(isOld);
  if (oldJobs.length === 0) return;
  const recentJobs = jobs.filter((j) => !isOld(j));

  const { date, time } = perthNowParts();
  const archiveFile = file.replace(
    /\.json$/,
    `.${date}-${time.replace(":", "")}.json`,
  );
  // 先写备份再改原文件，中途出错也不会丢数据
  saveRejectedJobs(oldJobs, archiveFile);
  jobs.splice(0, jobs.length, ...recentJobs);
  saveRejectedJobs(jobs, file);

  console.log(
    `🗄️  [Rejected] Archived ${oldJobs.length} job(s) older than ${KEEP_RECENT_DAYS} days to ${path.basename(archiveFile)}; kept ${recentJobs.length}.`,
  );
}
