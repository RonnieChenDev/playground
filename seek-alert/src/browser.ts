import * as fs from "fs";
import puppeteer, { Browser } from "puppeteer-core";
import { withTimeout } from "./time";

export function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    (process.env.LOCALAPPDATA ?? "") +
      "\Google\Chrome\Application\chrome.exe",
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

export async function createBrowser(): Promise<Browser> {
  const chromePath = findChrome();
  console.log(`   Using browser: ${chromePath}`);
  return await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    timeout: 60000,
    // 单条 CDP 指令（evaluate / newPage / close 等）的超时，防止渲染进程崩溃后一直等不到响应
    protocolTimeout: 60000,
    // 注意：不要加 --single-process，Linux 下容易导致页面崩溃和 browser.close() 永久挂起
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
      "--js-flags=--max-old-space-size=128",
    ],
  });
}

// browser.close() 在 Chrome 卡死时可能永远不返回；超时后直接杀掉进程，避免残留 Chrome 吃光内存
export async function closeBrowser(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  try {
    await withTimeout(browser.close(), 10000, "browser.close()");
  } catch (err) {
    console.error("⚠️  Failed to close browser gracefully, killing it:", err);
    browser.process()?.kill("SIGKILL");
  }
}
