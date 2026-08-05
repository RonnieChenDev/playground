import { Job } from "./types";
import { createBrowser } from "./browser";

export async function fetchSeekJobs(seekUrl: string): Promise<Job[]> {
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
          // href 常带 SEEK 每次搜索会话生成的追踪参数（?ref=...&sol=...），
          // 必须只取纯数字 job id，否则同一职位每次抓到的 id 都不一样，去重会失效
          const hrefJobId = href.match(/\/job\/(\d+)/)?.[1] ?? "";
          const id = jobId || hrefJobId || href.split("/").pop() || "";
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

export async function fetchJobDescriptionsForNewJobs(
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
