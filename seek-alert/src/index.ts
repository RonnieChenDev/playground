import * as fs from "fs";
import * as path from "path";
import * as nodemailer from "nodemailer";
import "dotenv/config";
import puppeteer from "puppeteer-core";

let isChecking = false;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  listedAt: string;
}

interface Config {
  emailUser: string;
  emailAppPassword: string;
  emailTo: string;
  seekUrls: string[];
  indeedUrls: string[];
  seekCheckIntervalMs: number;
  indeedCheckIntervalMs: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig(): Config {
  const emailUser = process.env.EMAIL_USER ?? "";
  const emailAppPassword = process.env.EMAIL_APP_PASSWORD ?? "";
  const emailTo = process.env.EMAIL_TO ?? "";
  const seekUrls = (process.env.SEEK_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const indeedUrls = (process.env.INDEED_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const seekInterval = parseInt(
    process.env.SEEK_CHECK_INTERVAL_MINUTES ?? "30",
    10,
  );
  const indeedInterval = parseInt(
    process.env.INDEED_CHECK_INTERVAL_MINUTES ?? "30",
    10,
  );

  if (!emailUser || emailUser === "yourname@gmail.com") {
    console.error("❌ Set EMAIL_USER in .env");
    process.exit(1);
  }
  if (!emailAppPassword || emailAppPassword.includes("xxxx")) {
    console.error("❌ Set EMAIL_APP_PASSWORD in .env");
    process.exit(1);
  }
  if (seekUrls.length === 0 && indeedUrls.length === 0) {
    console.error("❌ Set at least one SEEK_URLS or INDEED_URLS in .env");
    process.exit(1);
  }

  return {
    emailUser,
    emailAppPassword,
    emailTo: emailTo || emailUser,
    seekUrls,
    indeedUrls,
    seekCheckIntervalMs: seekInterval * 60 * 1000,
    indeedCheckIntervalMs: indeedInterval * 60 * 1000,
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const SEEK_SEEN_FILE = path.join(__dirname, "seen-jobs-seek.json");
const INDEED_SEEN_FILE = path.join(__dirname, "seen-jobs-indeed.json");

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
          url: `https://www.seek.com.au/job/${id}`,
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
                : `https://www.seek.com.au${href}`,
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

// ─── Indeed Fetcher ───────────────────────────────────────────────────────────

async function fetchIndeedJobs(indeedUrl: string): Promise<Job[]> {
  const jobs: Job[] = [];
  let browser;
  try {
    browser = await createBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    );
    await page.goto(indeedUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Strategy 1: window mosaic data
    const mosaicData = await page.evaluate(() => {
      const w = window as any;
      const provider = w["mosaic-provider-jobcards"];
      return provider?.model?.results ?? null;
    });

    if (Array.isArray(mosaicData)) {
      for (const item of mosaicData) {
        const id = item.jobkey ?? "";
        if (!id) continue;
        jobs.push({
          id,
          title: item.displayTitle ?? item.title ?? "",
          company: item.company ?? "",
          location: item.formattedLocation ?? item.location ?? "",
          url: `https://au.indeed.com/viewjob?jk=${id}`,
          listedAt: item.pubDate ?? item.formattedRelativeTime ?? "",
        });
      }
    }

    // Strategy 2: DOM fallback
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
        const cards = document.querySelectorAll("[data-jk]");
        cards.forEach((card) => {
          const el = card as HTMLElement;
          const id = el.getAttribute("data-jk") ?? "";
          if (!id) return;
          const title =
            el
              .querySelector('[data-testid="job-title"] span, h2 a span')
              ?.textContent?.trim() ?? "";
          const company =
            el
              .querySelector('[data-testid="company-name"]')
              ?.textContent?.trim() ?? "";
          const location =
            el
              .querySelector('[data-testid="text-location"]')
              ?.textContent?.trim() ?? "";
          const listedAt =
            el
              .querySelector('[data-testid="myJobsStateDate"]')
              ?.textContent?.trim() ?? "";
          results.push({
            id,
            title: title || "Unknown Title",
            company: company || "Unknown Company",
            location: location || "",
            url: `https://au.indeed.com/viewjob?jk=${id}`,
            listedAt: listedAt || "Recently",
          });
        });
        return results;
      });
      jobs.push(...domJobs);
    }

    await page.close();
    await browser.close();
  } catch (err) {
    console.error(`❌ [Indeed] Failed to fetch ${indeedUrl}:`, err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return jobs;
}

// ─── Email Notifier ───────────────────────────────────────────────────────────

function createTransporter(config: Config) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.emailUser, pass: config.emailAppPassword },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendJobEmail(
  config: Config,
  jobs: Job[],
  searchLabel: string,
  platform: "seek" | "indeed",
): Promise<void> {
  const transporter = createTransporter(config);
  const platformLabel = platform === "seek" ? "SEEK" : "Indeed";

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

  const html = `
    <h2 style="color:#333">🆕 ${jobs.length} new job(s) found</h2>
    <p style="color:#666">Search: ${escapeHtml(searchLabel)}</p>
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
    </table>
    <p style="color:#999;font-size:12px;margin-top:16px">Sent by ${platformLabel} Job Alert</p>
  `;

  try {
    await transporter.sendMail({
      from: config.emailUser,
      to: config.emailTo,
      subject: `🔔 ${platformLabel}: ${jobs.length} new ${jobs.length === 1 ? "job" : "jobs"} — ${searchLabel}`,
      html,
    });
  } catch (err) {
    console.error(`❌ [${platformLabel}] Failed to send email:`, err);
  }
}

// ─── Check Loop ───────────────────────────────────────────────────────────────

async function checkOnce(
  platform: "seek" | "indeed",
  urls: string[],
  seenFile: string,
  config: Config,
  seenIds: Set<string>,
): Promise<void> {
  for (const url of urls) {
    const label =
      platform === "seek"
        ? decodeURIComponent(
            url.replace("https://www.seek.com.au/", "").replace(/\//g, " › "),
          )
        : (() => {
            try {
              return decodeURIComponent(
                new URL(url).searchParams.get("q") ?? url,
              );
            } catch {
              return url;
            }
          })();

    console.log(`🔍 [${platform.toUpperCase()}] Checking: ${label}`);

    const jobs =
      platform === "seek"
        ? await fetchSeekJobs(url)
        : await fetchIndeedJobs(url);

    console.log(`   Found ${jobs.length} jobs`);

    const newJobs: Job[] = [];
    for (const job of jobs) {
      if (!job.id || seenIds.has(job.id)) continue;
      seenIds.add(job.id);
      newJobs.push(job);
    }

    if (newJobs.length > 0) {
      await sendJobEmail(config, newJobs, label, platform);
      console.log(`🎉 Emailed ${newJobs.length} new job(s)!`);
    } else {
      console.log("✅ No new jobs for this search.");
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  saveSeenIds(seenIds, seenFile);
}

// ─── Platform Runner ──────────────────────────────────────────────────────────

async function startPlatform(
  platform: "seek" | "indeed",
  urls: string[],
  seenFile: string,
  checkIntervalMs: number,
  config: Config,
): Promise<void> {
  const platformLabel = platform === "seek" ? "SEEK" : "Indeed";
  const seenIds = loadSeenIds(seenFile);

  console.log(`🚀 ${platformLabel} Job Alert started`);
  console.log(
    `   Monitoring ${urls.length} search(es), every ${checkIntervalMs / 60000} minutes`,
  );
  console.log(`   Alerts → ${config.emailTo}`);
  console.log(`   ${seenIds.size} previously seen jobs loaded\n`);

  if (seenIds.size === 0) {
    console.log(
      `📝 [${platformLabel}] First run — marking existing jobs as seen (no emails sent)`,
    );
    for (const url of urls) {
      const jobs =
        platform === "seek"
          ? await fetchSeekJobs(url)
          : await fetchIndeedJobs(url);
      for (const job of jobs) {
        if (job.id) seenIds.add(job.id);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    saveSeenIds(seenIds, seenFile);
    console.log(`   Marked ${seenIds.size} existing jobs as seen.\n`);
  }

  await checkOnce(platform, urls, seenFile, config, seenIds);

  setInterval(async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const now = new Date().toLocaleTimeString("en-AU", {
        timeZone: "Australia/Perth",
      });
      console.log(
        `\n⏰ [${now}] [${platformLabel}] Running scheduled check...`,
      );
      await checkOnce(platform, urls, seenFile, config, seenIds);
    } finally {
      isChecking = false;
    }
  }, checkIntervalMs);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.seekUrls.length > 0) {
    startPlatform(
      "seek",
      config.seekUrls,
      SEEK_SEEN_FILE,
      config.seekCheckIntervalMs,
      config,
    );
  } else {
    console.log("⚠️  No SEEK_URLS set, skipping SEEK.");
  }

  if (config.indeedUrls.length > 0) {
    startPlatform(
      "indeed",
      config.indeedUrls,
      INDEED_SEEN_FILE,
      config.indeedCheckIntervalMs,
      config,
    );
  } else {
    console.log("⚠️  No INDEED_URLS set, skipping Indeed.");
  }
}

main().catch(console.error);