import { AnalysisRequest, AnalysisResponse, JobAnalysis } from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

async function analyseJob(
  request: AnalysisRequest,
  apiKey: string
): Promise<JobAnalysis> {
  const prompt = `You are analysing a job listing for a candidate. Return ONLY a JSON object, no markdown, no explanation.

Candidate's skills: ${request.userProfile.skills.join(", ")}
Candidate's level: ${request.userProfile.experience}

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
  "fitReason": "one sentence explanation"
}

fitScore rules:
- green: candidate matches 70%+ of required skills
- yellow: candidate matches 40-69% of required skills  
- red: candidate matches less than 40% of required skills`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "API request failed");
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as JobAnalysis;
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
      const analysis = await analyseJobWithRetry(
        { jobText: message.jobText, userProfile: stored.userProfile },
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