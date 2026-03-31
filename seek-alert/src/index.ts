import * as fs from "fs";
import * as path from "path";
import * as nodemailer from "nodemailer";
import "dotenv/config";

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
  checkIntervalMs: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig(): Config {
  const emailUser = process.env.EMAIL_USER ?? "";
  const emailAppPassword = process.env.EMAIL_APP_PASSWORD ?? "";
  const emailTo = process.env.EMAIL_TO ?? "";
  const urls = (process.env.SEEK_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const interval = parseInt(process.env.CHECK_INTERVAL_MINUTES ?? "30", 10);

  if (!emailUser || emailUser === "yourname@gmail.com") {
    console.error("❌ Set EMAIL_USER in .env");
    process.exit(1);
  }
  if (!emailAppPassword || emailAppPassword.includes("xxxx")) {
    console.error("❌ Set EMAIL_APP_PASSWORD in .env");
    process.exit(1);
  }
  if (urls.length === 0) {
    console.error("❌ Set at least one SEEK_URLS in .env");
    process.exit(1);
  }

  return {
    emailUser,
    emailAppPassword,
    emailTo: emailTo || emailUser,
    seekUrls: urls,
    checkIntervalMs: interval * 60 * 1000,
  };
}

// ─── Persistence (simple JSON file) ─────────────────────────────────────────

const SEEN_FILE = path.join(__dirname, "seen-jobs.json");

function loadSeenIds(): Set<string> {
  try {
    const data = fs.readFileSync(SEEN_FILE, "utf-8");
    return new Set(JSON.parse(data));
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>): void {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...ids], null, 2));
}

// ─── SEEK Fetcher (Puppeteer) ───────────────────────────────────────────────

import puppeteer from "puppeteer-core";

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    (process.env.LOCALAPPDATA ?? "") + "\\Google\\Chrome\\Application\\chrome.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Linux
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
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
}

async function fetchJobsFromUrl(seekUrl: string): Promise<Job[]> {
  const jobs: Job[] = [];

  try {
    const browser = await createBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    await page.goto(seekUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract from __NEXT_DATA__ (most reliable)
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
      // SEEK nests search results in different paths depending on page version
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

    // Fallback: extract from DOM if __NEXT_DATA__ didn't work
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
          '[data-testid="job-card"], [data-card-type="JobCard"], article[data-job-id]'
        );

        cards.forEach((card) => {
          const el = card as HTMLElement;
          const jobId = el.dataset.jobId ?? el.id?.replace("job-", "") ?? "";
          const linkEl = el.querySelector("a[data-testid*='title'], h3 a, a[data-automation='jobTitle']") as HTMLAnchorElement | null;
          const title = linkEl?.textContent?.trim() ?? "";
          const href = linkEl?.getAttribute("href") ?? "";
          const company =
            (el.querySelector("[data-testid*='company'], [data-automation='jobCompany']") as HTMLElement)
              ?.textContent?.trim() ?? "";
          const location =
            (el.querySelector("[data-testid*='location'], [data-automation='jobLocation']") as HTMLElement)
              ?.textContent?.trim() ?? "";
          const listedAt =
            (el.querySelector("[data-testid*='listed'], time, [data-automation='jobListingDate']") as HTMLElement)
              ?.textContent?.trim() ?? "";

          const id = jobId || href.split("/").pop() || "";
          if (id) {
            results.push({
              id,
              title: title || "Unknown Title",
              company: company || "Unknown Company",
              location: location || "Perth WA",
              url: href.startsWith("http") ? href : `https://www.seek.com.au${href}`,
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
    console.error(`❌ Failed to fetch ${seekUrl}:`, err);
  }

  return jobs;
}

// ─── Email Notifier ─────────────────────────────────────────────────────────

function createTransporter(config: Config) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.emailUser,
      pass: config.emailAppPassword,
    },
  });
}

async function sendJobEmail(
  config: Config,
  jobs: Job[],
  searchLabel: string
): Promise<void> {
  const transporter = createTransporter(config);

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
        </tr>`
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
    <p style="color:#999;font-size:12px;margin-top:16px">Sent by SEEK Job Alert</p>
  `;

  try {
    await transporter.sendMail({
      from: config.emailUser,
      to: config.emailTo,
      subject: `🔔 SEEK: ${jobs.length} new ${jobs.length === 1 ? "job" : "jobs"} — ${searchLabel}`,
      html,
    });
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function checkOnce(config: Config, seenIds: Set<string>): Promise<void> {
  for (const seekUrl of config.seekUrls) {
    const label = decodeURIComponent(
      seekUrl.replace("https://www.seek.com.au/", "").replace(/\//g, " › ")
    );
    console.log(`🔍 Checking: ${label}`);

    const jobs = await fetchJobsFromUrl(seekUrl);
    console.log(`   Found ${jobs.length} jobs`);

    const newJobs: Job[] = [];
    for (const job of jobs) {
      if (!job.id || seenIds.has(job.id)) continue;
      seenIds.add(job.id);
      newJobs.push(job);
    }

    // Batch new jobs into one email per search URL (less spam)
    if (newJobs.length > 0) {
      await sendJobEmail(config, newJobs, label);
      console.log(`🎉 Emailed ${newJobs.length} new job(s)!`);
    } else {
      console.log("✅ No new jobs for this search.");
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  saveSeenIds(seenIds);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const seenIds = loadSeenIds();

  console.log("🚀 SEEK Job Alert started");
  console.log(`   Monitoring ${config.seekUrls.length} search(es)`);
  console.log(`   Checking every ${config.checkIntervalMs / 60000} minutes`);
  console.log(`   Alerts → ${config.emailTo}`);
  console.log(`   ${seenIds.size} previously seen jobs loaded`);
  console.log("");

  // First run: mark all current jobs as seen (no alert flood)
  if (seenIds.size === 0) {
    console.log("📝 First run — marking existing jobs as seen (no emails sent)");
    for (const seekUrl of config.seekUrls) {
      const jobs = await fetchJobsFromUrl(seekUrl);
      for (const job of jobs) {
        if (job.id) seenIds.add(job.id);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    saveSeenIds(seenIds);
    console.log(`   Marked ${seenIds.size} existing jobs as seen.\n`);
  }

  await checkOnce(config, seenIds);

  setInterval(async () => {
    const now = new Date().toLocaleTimeString("en-AU", {
      timeZone: "Australia/Perth",
    });
    console.log(`\n⏰ [${now}] Running scheduled check...`);
    await checkOnce(config, seenIds);
  }, config.checkIntervalMs);
}

main().catch(console.error);