import * as fs from "fs";
import * as path from "path";
import * as nodemailer from "nodemailer";
import "dotenv/config";
import puppeteer from "puppeteer-core";
import {
  SQSClient,
  CreateQueueCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  listedAt: string;
}

interface SmtpConfig {
  emailUser: string;
  emailAppPassword: string;
}

interface AiFilterConfig {
  enabled: boolean;
  model?: string;
  unwantedCriteria: string[];
}

interface DeliveryConfig {
  mode: "realtime" | "digest";
  digestTimes: string[]; // "HH:mm", Perth time. Only used when mode === "digest".
}

interface Profile {
  name: string;
  emailTo: string;
  emailSubjectPrefix?: string;
  seekUrls: string[];
  seekCheckIntervalMs: number;
  titleExcludeKeywords?: string[];
  aiFilter?: AiFilterConfig;
  delivery: DeliveryConfig;
}

interface AppConfig {
  smtp: SmtpConfig;
  anthropicApiKey?: string;
  profiles: Profile[];
}

const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

// ─── Config ──────────────────────────────────────────────────────────────────

function parseDeliveryConfig(raw: any, profileName: string): DeliveryConfig {
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

function loadConfig(): AppConfig {
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

// ─── Persistence ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function seenFileFor(profileName: string): string {
  return path.join(
    DATA_DIR,
    `seen-jobs-seek-${sanitizeFileName(profileName)}.json`,
  );
}

function loadSeenIds(file: string): Set<string> {
  try {
    const data = fs.readFileSync(file, "utf-8");
    return new Set(JSON.parse(data));
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>, file: string): void {
  fs.writeFileSync(file, JSON.stringify([...ids], null, 2));
}

interface RejectedJob extends Job {
  reason: string;
  filteredBy: "keyword" | "ai";
  rejectedAt: string;
}

function rejectedFileFor(profileName: string): string {
  return path.join(
    DATA_DIR,
    `rejected-jobs-seek-${sanitizeFileName(profileName)}.json`,
  );
}

function loadRejectedJobs(file: string): RejectedJob[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveRejectedJobs(jobs: RejectedJob[], file: string): void {
  fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
}

interface PendingJob extends Job {
  label: string;
  foundAt: string;
}

interface DigestState {
  date: string; // "YYYY-MM-DD", Perth time
  firedTimes: string[]; // "HH:mm" entries already sent today
}

function digestStateFileFor(profileName: string): string {
  return path.join(
    DATA_DIR,
    `digest-state-seek-${sanitizeFileName(profileName)}.json`,
  );
}

function loadDigestState(file: string): DigestState {
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

function saveDigestState(state: DigestState, file: string): void {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

// ─── SQS Digest Queue ────────────────────────────────────────────────────────
// 汇总（digest）模式下"待发职位"用 AWS SQS 存储，而不是本地文件：
// - enqueuePendingJobs：新筛出的合格职位塞进队列
// - drainPendingJobs：到了汇总发送时间点时，把队列里攒的全部职位取出并删除

const AWS_REGION = process.env.AWS_REGION ?? "ap-southeast-2";
const sqsClient = new SQSClient({ region: AWS_REGION });

async function getOrCreateDigestQueueUrl(profileName: string): Promise<string> {
  const queueName = `seek-alert-digest-${sanitizeFileName(profileName)}`;
  const res = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        MessageRetentionPeriod: String(14 * 24 * 60 * 60), // 14 天
      },
    }),
  );
  if (!res.QueueUrl) {
    throw new Error(`Failed to resolve SQS queue URL for "${queueName}"`);
  }
  return res.QueueUrl;
}

async function enqueuePendingJobs(
  queueUrl: string,
  jobs: PendingJob[],
): Promise<void> {
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);
    await sqsClient.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((job, idx) => ({
          Id: `${i + idx}`,
          MessageBody: JSON.stringify(job),
        })),
      }),
    );
  }
}

async function drainPendingJobs(queueUrl: string): Promise<PendingJob[]> {
  const jobs: PendingJob[] = [];
  for (let iterations = 0; iterations < 50; iterations++) {
    const res = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );
    const messages = res.Messages ?? [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      try {
        jobs.push(JSON.parse(msg.Body ?? "{}"));
      } catch (err) {
        console.error("❌ [Digest] Failed to parse SQS message body:", err);
      }
    }

    await sqsClient.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: messages.map((msg, idx) => ({
          Id: `${idx}`,
          ReceiptHandle: msg.ReceiptHandle!,
        })),
      }),
    );
  }
  return jobs;
}

function perthNowParts(): { date: string; time: string } {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
  const time = now.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Perth",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // hour12:false 在某些 Node/ICU 环境下午夜返回 "24:xx" 而非 "00:xx"，需显式指定 h23
  });
  return { date, time };
}

// ─── Browser ─────────────────────────────────────────────────────────────────

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    (process.env.LOCALAPPDATA ?? "") +
      "\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error("❌ Chrome/Chromium not found. Set CHROME_PATH in .env");
}

async function createBrowser() {
  const chromePath = findChrome();
  console.log(`   Using browser: ${chromePath}`);
  return await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--no-first-run",
      "--single-process",
      "--js-flags=--max-old-space-size=128",
    ],
  });
}

// ─── SEEK Fetcher ─────────────────────────────────────────────────────────────

async function fetchSeekJobs(seekUrl: string): Promise<Job[]> {
  const jobs: Job[] = [];
  let browser;
  try {
    browser = await createBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    );
    await page.goto(seekUrl, { waitUntil: "networkidle2", timeout: 30000 });

    const nextData = await page.evaluate(() => {
      const el = document.querySelector("script#__NEXT_DATA__");
      if (!el?.textContent) return null;
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    });

    if (nextData?.props?.pageProps) {
      const pageProps = nextData.props.pageProps;
      const searchResults =
        pageProps.searchResults?.data ??
        pageProps.jobSearch?.data ??
        pageProps.results?.data ??
        [];
      for (const item of searchResults) {
        const id = String(item.id ?? item.jobId ?? "");
        if (!id) continue;
        jobs.push({
          id,
          title: item.title ?? item.jobTitle ?? "",
          company: item.advertiser?.description ?? item.companyName ?? "",
          location: item.location ?? item.suburb ?? "",
          url: `https://au.seek.com/job/${id}`,
          listedAt: item.listedAt ?? item.listingDate ?? "",
        });
      }
    }

    if (jobs.length === 0) {
      const domJobs = await page.evaluate(() => {
        const results: Array<{
          id: string;
          title: string;
          company: string;
          location: string;
          url: string;
          listedAt: string;
        }> = [];
        const cards = document.querySelectorAll(
          '[data-testid="job-card"], [data-card-type="JobCard"], article[data-job-id]',
        );
        cards.forEach((card) => {
          const el = card as HTMLElement;
          const jobId = el.dataset.jobId ?? el.id?.replace("job-", "") ?? "";
          const linkEl = el.querySelector(
            "a[data-testid*='title'], h3 a, a[data-automation='jobTitle']",
          ) as HTMLAnchorElement | null;
          const title = linkEl?.textContent?.trim() ?? "";
          const href = linkEl?.getAttribute("href") ?? "";
          const company =
            (
              el.querySelector(
                "[data-testid*='company'], [data-automation='jobCompany']",
              ) as HTMLElement
            )?.textContent?.trim() ?? "";
          const location =
            (
              el.querySelector(
                "[data-testid*='location'], [data-automation='jobLocation']",
              ) as HTMLElement
            )?.textContent?.trim() ?? "";
          const listedAt =
            (
              el.querySelector(
                "[data-testid*='listed'], time, [data-automation='jobListingDate']",
              ) as HTMLElement
            )?.textContent?.trim() ?? "";
          const id = jobId || href.split("/").pop() || "";
          if (id) {
            results.push({
              id,
              title: title || "Unknown Title",
              company: company || "Unknown Company",
              location: location || "Perth WA",
              url: href.startsWith("http")
                ? href
                : `https://au.seek.com${href}`,
              listedAt: listedAt || "Recently",
            });
          }
        });
        return results;
      });
      jobs.push(...domJobs);
    }

    await page.close();
    await browser.close();
  } catch (err) {
    console.error(`❌ [SEEK] Failed to fetch ${seekUrl}:`, err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return jobs;
}

async function fetchJobDescriptionsForNewJobs(
  jobs: Job[],
): Promise<Map<string, string>> {
  const descriptions = new Map<string, string>();
  if (jobs.length === 0) return descriptions;

  let browser;
  try {
    browser = await createBrowser();
    for (const job of jobs) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        );
        await page.goto(job.url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        const description = await page.evaluate(() => {
          const el =
            document.querySelector('[data-automation="jobAdDetails"]') ??
            document.querySelector('[data-testid="jobAdDetails"]') ??
            document.querySelector("article");
          return el?.textContent?.trim() ?? "";
        });
        descriptions.set(job.id, description);
      } catch (err) {
        console.error(`❌ Failed to fetch description for ${job.url}:`, err);
        descriptions.set(job.id, "");
      } finally {
        await page.close();
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return descriptions;
}

// ─── AI Filter ────────────────────────────────────────────────────────────────

interface ClassifyResult {
  reject: boolean;
  reason: string;
}

async function classifyJobWithClaude(
  apiKey: string,
  model: string,
  unwantedCriteria: string[],
  job: Job,
  description: string,
): Promise<ClassifyResult> {
  const systemPrompt = `你是一个求职助手，帮用户筛掉不想看到的职位。
用户不想要满足以下任一条件的职位（命中任意一条就应该 reject: true）：
${unwantedCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

只输出严格 JSON，不要有任何多余文字、不要用 markdown 代码块包裹：
{"reject": boolean, "reason": string}`;

  const userContent = `职位标题：${job.title}
公司：${job.company}
地点：${job.location}
职位描述：
${description || "(未能获取详情描述，仅凭标题/公司判断)"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data: any = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Unexpected Claude response: ${text}`);

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    reject: Boolean(parsed.reject),
    reason: String(parsed.reason ?? ""),
  };
}

// ─── Email Notifier ───────────────────────────────────────────────────────────

interface EmailGroup {
  label: string;
  jobs: Job[];
}

function createTransporter(smtp: SmtpConfig) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: smtp.emailUser, pass: smtp.emailAppPassword },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderJobTable(jobs: Job[]): string {
  const jobRows = jobs
    .map(
      (job) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee">
            <a href="${job.url}" style="font-weight:bold;color:#0d6efd;text-decoration:none">${escapeHtml(job.title)}</a>
          </td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(job.company)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(job.location)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(job.listedAt)}</td>
        </tr>`,
    )
    .join("\n");

  return `
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px">
      <thead>
        <tr style="background:#f8f9fa">
          <th style="padding:8px;text-align:left">Title</th>
          <th style="padding:8px;text-align:left">Company</th>
          <th style="padding:8px;text-align:left">Location</th>
          <th style="padding:8px;text-align:left">Listed</th>
        </tr>
      </thead>
      <tbody>${jobRows}</tbody>
    </table>`;
}

async function sendJobEmail(
  smtp: SmtpConfig,
  emailTo: string,
  groups: EmailGroup[],
  subjectPrefix?: string,
): Promise<void> {
  const nonEmptyGroups = groups.filter((g) => g.jobs.length > 0);
  const totalCount = nonEmptyGroups.reduce((sum, g) => sum + g.jobs.length, 0);
  if (totalCount === 0) return;

  const transporter = createTransporter(smtp);

  const sections = nonEmptyGroups
    .map(
      (group) => `
    <h3 style="color:#333;margin-top:24px">${escapeHtml(group.label)} (${group.jobs.length})</h3>
    ${renderJobTable(group.jobs)}`,
    )
    .join("\n");

  const html = `
    <h2 style="color:#333">🆕 ${totalCount} new job(s) found</h2>
    ${sections}
    <p style="color:#999;font-size:12px;margin-top:16px">Sent by SEEK Job Alert</p>
  `;

  try {
    await transporter.sendMail({
      from: smtp.emailUser,
      to: emailTo,
      subject: `${subjectPrefix ? subjectPrefix + " " : ""}🔔 SEEK: ${totalCount} new ${totalCount === 1 ? "job" : "jobs"}`,
      html,
    });
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}

// ─── Check Loop ───────────────────────────────────────────────────────────────

async function checkOnce(
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

    // 去重要同时排除“已推送”和“已被过滤（关键词/AI）”两个列表
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

// ─── Delivery Dispatcher ──────────────────────────────────────────────────────

async function dispatchResults(
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

// ─── Profile Runner ───────────────────────────────────────────────────────────

async function startSeekMonitor(
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

  await runCheck();

  setInterval(async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const now = new Date().toLocaleTimeString("en-AU", {
        timeZone: "Australia/Perth",
      });
      console.log(
        `\n⏰ [${now}] [SEEK:${profile.name}] Running scheduled check...`,
      );
      await runCheck();
    } finally {
      isChecking = false;
    }
  }, profile.seekCheckIntervalMs);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { smtp, anthropicApiKey, profiles } = loadConfig();

  for (const profile of profiles) {
    startSeekMonitor(profile, smtp, anthropicApiKey).catch((err) =>
      console.error(`❌ [SEEK:${profile.name}] monitor crashed:`, err),
    );
  }
}

main().catch(console.error);
