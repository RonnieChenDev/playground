import {
  AnalyseJobMessage,
  AnalysisRequest,
  AnalysisResponse,
  CachedAnalysis,
  JobAnalysis,
  UserProfile,
} from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Public (logged-out) job posting endpoint — returns an HTML fragment with the
// full description, so we never send the user's LinkedIn session cookies.
const LINKEDIN_JOB_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";

const CACHE_PREFIX = "job:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Gap between uncached jobs, to stay under both Anthropic and LinkedIn rate limits
const QUEUE_GAP_MS = 3000;
const MAX_DESCRIPTION_CHARS = 12000;

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isNaN(n) ? m : String.fromCodePoint(n);
    }
    return named[code.toLowerCase()] ?? m;
  });
}

function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Service workers have no DOMParser, so slice the description + criteria
// (seniority level, employment type, ...) out of the fragment by class name.
function extractDescription(html: string): string | null {
  const start = html.indexOf("show-more-less-html__markup");
  if (start === -1) return null;

  const contentStart = html.indexOf(">", start) + 1;
  const criteriaStart = html.indexOf("description__job-criteria-list", start);
  const end = criteriaStart === -1 ? -1 : html.indexOf("</ul>", criteriaStart);
  const slice = html.slice(contentStart, end === -1 ? contentStart + 60000 : end);

  const text = htmlToText(slice)
    .replace(/^\s*Show (more|less)\s*$/gim, "")
    .trim();
  return text ? text.slice(0, MAX_DESCRIPTION_CHARS) : null;
}

async function fetchJobDescription(jobId: string): Promise<string | null> {
  try {
    const res = await fetch(LINKEDIN_JOB_URL + jobId, { credentials: "omit" });
    if (!res.ok) return null;
    return extractDescription(await res.text());
  } catch {
    return null;
  }
}

async function analyseJob(
  request: AnalysisRequest,
  apiKey: string
): Promise<JobAnalysis> {
  const prompt = `You are analysing a LinkedIn job listing for a candidate. Return ONLY a JSON object, no markdown, no explanation.

Candidate's skills: ${request.userProfile.skills.join(", ")}
Candidate's level: ${request.userProfile.experience.join(", ")}
Candidate's visa status: ${request.userProfile.visaStatus}

Job listing text:
"""
${request.jobText}
"""

Return this exact JSON structure:
{
  "jobType": "job title/role type",
  "location": "city and state",
  "requiredSkills": ["skill1", "skill2"],
  "niceToHaveSkills": ["skill1", "skill2"],
  "fitScore": "green" | "yellow" | "red",
  "fitReason": "one sentence explanation",
  "citizenshipRequired": "citizen_only" | "pr_or_citizen" | "any_work_rights" | "unknown",
  "experienceLevel": "junior" | "mid" | "senior" | "unknown"
}

fitScore rules:
- green: candidate matches 70%+ of required skills
- yellow: candidate matches 40-69% of required skills
- red: candidate matches less than 40% of required skills

location note:
- Do NOT factor location into fitScore or fitReason. Assume the candidate is already searching in the right location.

experienceLevel rules:
- senior: listing explicitly requires 5+ years, "senior", "lead", "principal", or similar
- mid: listing requires 2-5 years or "mid-level"
- junior: listing is entry level, graduate, internship, or junior
- unknown: experience level not mentioned
- LinkedIn's "Seniority level" field is often inaccurate; prefer what the description itself says

visa eligibility note:
- If citizenshipRequired is citizen_only or pr_or_citizen, and candidate visa is work_visa or student_visa, reflect this ineligibility in fitScore (cap at yellow) and mention it in fitReason
- If citizenshipRequired is citizen_only and candidate is pr, cap fitScore at yellow and mention it in fitReason

citizenshipRequired rules:
- citizen_only: listing explicitly requires Australian citizen only (e.g. security clearance, government roles, "must be Australian citizen")
- pr_or_citizen: listing requires permanent resident OR citizen (e.g. "PR or citizen", "must have PR", "permanent residency required")
- any_work_rights: listing accepts any valid work rights, all visa types welcome, sponsorship available, or does not restrict by visa/citizenship
- unknown: visa or citizenship requirements are not mentioned at all`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "API request failed");
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as JobAnalysis;
  parsed.visaStatus = request.userProfile.visaStatus;
  parsed.candidateExperience = request.userProfile.experience;
  return parsed;
}

async function analyseJobWithRetry(
  request: AnalysisRequest,
  apiKey: string,
  retries = 3,
  delayMs = 5000
): Promise<JobAnalysis> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await analyseJob(request, apiKey);
    } catch (e: any) {
      const isRateLimit =
        e.message?.toLowerCase().includes("rate") ||
        e.message?.toLowerCase().includes("concurrent");

      if (isRateLimit && attempt < retries) {
        // 5s → 10s → 20s
        await new Promise(res => setTimeout(res, delayMs * attempt));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Max retries exceeded");
}

function profileSignature(profile: UserProfile): string {
  return JSON.stringify([profile.skills, profile.experience, profile.visaStatus]);
}

async function readCache(jobId: string, profileSig: string): Promise<JobAnalysis | null> {
  const key = CACHE_PREFIX + jobId;
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as CachedAnalysis | undefined;
  if (!entry) return null;
  if (entry.profileSig !== profileSig || Date.now() - entry.at > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry.analysis;
}

async function writeCache(jobId: string, profileSig: string, analysis: JobAnalysis) {
  const entry: CachedAnalysis = { analysis, profileSig, at: Date.now() };
  await chrome.storage.local.set({ [CACHE_PREFIX + jobId]: entry });
}

// Uncached jobs are processed one at a time with a gap between them.
let queue: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<JobAnalysis>>();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run
    .catch(() => {})
    .then(() => new Promise(res => setTimeout(res, QUEUE_GAP_MS)));
  return run;
}

async function getAnalysis(
  message: AnalyseJobMessage,
  profile: UserProfile,
  apiKey: string
): Promise<JobAnalysis> {
  const sig = profileSignature(profile);
  const cached = await readCache(message.jobId, sig);
  if (cached) return cached;

  const existing = inFlight.get(message.jobId);
  if (existing) return existing;

  const promise = enqueue(async () => {
    // Paused while waiting in the queue — don't spend API calls on it
    if ((await chrome.storage.sync.get("paused")).paused) {
      throw new Error("Paused");
    }
    const description = await fetchJobDescription(message.jobId);
    const jobText = description
      ? `${message.cardText}\n\n${description}`
      : message.cardText;
    const analysis = await analyseJobWithRetry({ jobText, userProfile: profile }, apiKey);
    await writeCache(message.jobId, sig, analysis);
    return analysis;
  }).finally(() => inFlight.delete(message.jobId));

  inFlight.set(message.jobId, promise);
  return promise;
}

function renderPausedBadge(paused: boolean) {
  chrome.action.setBadgeText({ text: paused ? "OFF" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
}

chrome.storage.sync.get("paused", (stored) => renderPausedBadge(!!stored.paused));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.paused) {
    renderPausedBadge(!!changes.paused.newValue);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "ANALYSE_JOB") return false;

  chrome.storage.sync.get(["apiKey", "userProfile"], async (stored) => {
    if (!stored.apiKey) {
      sendResponse({
        success: false,
        error: "No API key set. Please configure in Options."
      } as AnalysisResponse);
      return;
    }

    if (!stored.userProfile || stored.userProfile.skills.length === 0) {
      sendResponse({
        success: false,
        error: "No skills profile set. Please configure in Options."
      } as AnalysisResponse);
      return;
    }

    try {
      const analysis = await getAnalysis(
        message as AnalyseJobMessage,
        stored.userProfile,
        stored.apiKey
      );
      sendResponse({ success: true, data: analysis } as AnalysisResponse);
    } catch (e: any) {
      sendResponse({
        success: false,
        error: e.message
      } as AnalysisResponse);
    }
  });

  return true;
});
