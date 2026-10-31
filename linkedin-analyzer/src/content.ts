import { JobAnalysis, AnalysisResponse, AnalyseJobMessage } from "./types";

// LinkedIn renders job cards differently when logged in (scaffold list) and
// logged out (public search), and its class names churn — so cards are found
// by the job-id attributes, which have been far more stable.
const CARD_SOURCES: { selector: string; getId: (el: Element) => string | null }[] = [
  // Logged in: virtualised list item (empty until scrolled into view)
  {
    selector: "[data-occludable-job-id]",
    getId: (el) => el.getAttribute("data-occludable-job-id"),
  },
  // Logged in: card container outside the virtualised list (e.g. collections)
  {
    selector: "[data-job-id]",
    getId: (el) =>
      el.closest("[data-occludable-job-id]") ? null : el.getAttribute("data-job-id"),
  },
  // Logged out: public job search
  {
    selector: '[data-entity-urn*="urn:li:jobPosting:"]',
    getId: (el) =>
      el.getAttribute("data-entity-urn")?.match(/jobPosting:(\d+)/)?.[1] ?? null,
  },
];

// Tried in order — the generic /jobs/view/ link is the last resort.
const CARD_TITLE_SELECTORS = [
  ".job-card-list__title--link",
  ".job-card-container__link",
  ".base-search-card__title",
  'a[href*="/jobs/view/"]',
];

const DETAIL_TITLE_SELECTORS = [
  ".job-details-jobs-unified-top-card__job-title",
  ".jobs-unified-top-card__job-title",
  ".top-card-layout__title",
];

const BADGE_ATTR = "data-lja-job-id";

const analyses = new Map<string, Promise<AnalysisResponse>>();

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractCardText(card: Element): string {
  return (card.textContent?.replace(/\s+/g, " ").trim() ?? "").slice(0, 1000);
}

function requestAnalysis(jobId: string, cardText: string): Promise<AnalysisResponse> {
  let pending = analyses.get(jobId);
  if (!pending) {
    const message: AnalyseJobMessage = { type: "ANALYSE_JOB", jobId, cardText };
    pending = new Promise<AnalysisResponse>((resolve) => {
      chrome.runtime.sendMessage(message, (res: AnalysisResponse | undefined) => {
        resolve(
          res ?? {
            success: false,
            error: chrome.runtime.lastError?.message ?? "Analysis failed",
          }
        );
      });
    });
    analyses.set(jobId, pending);
  }
  return pending;
}

function createBadgeContainer(analysis: JobAnalysis, startExpanded = false): HTMLElement {
  const container = document.createElement("div");
  container.className = "lja-badge-container";

  let fitScore = (
    ["green", "yellow", "red"].includes(analysis.fitScore)
      ? analysis.fitScore
      : "yellow"
  ) as "green" | "yellow" | "red";

  const citizenshipRequired = (
    ["citizen_only", "pr_or_citizen", "any_work_rights", "unknown"].includes(
      analysis.citizenshipRequired,
    )
      ? analysis.citizenshipRequired
      : "unknown"
  ) as JobAnalysis["citizenshipRequired"];

  const visaStatus = analysis.visaStatus;
  if (
    citizenshipRequired === "citizen_only" ||
    (citizenshipRequired === "pr_or_citizen" &&
      visaStatus !== "citizen" &&
      visaStatus !== "pr")
  ) {
    fitScore = "red";
  }

  const experienceLevel = analysis.experienceLevel;
  const candidateExp = Array.isArray(analysis.candidateExperience)
    ? analysis.candidateExperience
    : [analysis.candidateExperience ?? ""];
  if (experienceLevel === "senior" && !candidateExp.includes("senior")) {
    fitScore = "red";
  }

  const colorMap = {
    green: {
      bg: "#dcfce7",
      border: "#16a34a",
      text: "#15803d",
      dot: "#16a34a",
    },
    yellow: {
      bg: "#fef9c3",
      border: "#ca8a04",
      text: "#a16207",
      dot: "#ca8a04",
    },
    red: { bg: "#fee2e2", border: "#dc2626", text: "#b91c1c", dot: "#dc2626" },
  };
  const colors = colorMap[fitScore];

  const citizenshipMap = {
    citizen_only: { text: "🔒 Citizens only", color: "#b91c1c" },
    pr_or_citizen: { text: "🔒 PR or Citizen required", color: "#b91c1c" },
    any_work_rights: { text: "✅ Any work rights accepted", color: "#15803d" },
    unknown: { text: "🔍 Visa: not stated", color: "#6b7280" },
  };
  const cit = citizenshipMap[citizenshipRequired];

  const badge = document.createElement("div");
  badge.className = "lja-badge";
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    border: 1px solid ${colors.border};
    background: ${colors.bg};
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    color: ${colors.text};
    cursor: pointer;
    user-select: none;
  `;

  const dot = document.createElement("span");
  dot.style.cssText = `
    width: 8px; height: 8px;
    border-radius: 50%;
    background: ${colors.dot};
    flex-shrink: 0;
  `;

  const label = document.createElement("span");
  label.textContent = analysis.fitReason;

  badge.appendChild(dot);
  badge.appendChild(label);

  const detail = document.createElement("div");
  detail.className = "lja-detail";
  detail.style.cssText = `
    display: ${startExpanded ? "block" : "none"};
    margin-top: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid ${colors.border};
    background: ${colors.bg};
    font-size: 12px;
    font-weight: 400;
    color: #374151;
    line-height: 1.6;
  `;

  const skillsHtml = (skills: unknown, cls: string) =>
    (Array.isArray(skills) ? skills : [])
      .map((s) => `<span class="lja-skill ${cls}">${escapeHtml(s)}</span>`)
      .join("");
  const requiredHtml = skillsHtml(analysis.requiredSkills, "lja-required");
  const niceHtml = skillsHtml(analysis.niceToHaveSkills, "lja-nice");

  detail.innerHTML = `
    <div style="margin-bottom:6px">
      <strong>Role:</strong> ${escapeHtml(analysis.jobType)} &nbsp;·&nbsp;
      <strong>Location:</strong> ${escapeHtml(analysis.location)}
    </div>
    <div style="margin-bottom:6px;color:${cit.color};font-weight:500">
      ${cit.text}
    </div>
    <div style="margin-bottom:4px">
      <strong>Required:</strong><br/>
      <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px">${requiredHtml}</div>
    </div>
    ${
      niceHtml
        ? `
    <div style="margin-top:6px">
      <strong>Nice to have:</strong><br/>
      <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px">${niceHtml}</div>
    </div>`
        : ""
    }
  `;

  let expanded = startExpanded;
  badge.addEventListener("click", (e) => {
    // Cards are links / click targets on LinkedIn — keep the toggle local
    e.preventDefault();
    e.stopPropagation();
    expanded = !expanded;
    detail.style.display = expanded ? "block" : "none";
  });
  detail.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  container.appendChild(badge);
  container.appendChild(detail);
  return container;
}

function createLoadingBadge(): HTMLElement {
  const el = document.createElement("div");
  el.className = "lja-pill";
  el.style.cssText = `
    border: 1px solid #d1d5db;
    background: #f9fafb;
    color: #6b7280;
  `;
  el.innerHTML = `
    <span style="
      width:8px;height:8px;border-radius:50%;
      border:2px solid #9ca3af;
      border-top-color:transparent;
      animation:lja-spin 0.7s linear infinite;
      flex-shrink:0;
    "></span>
    Analysing…
  `;
  return el;
}

function createErrorBadge(message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "lja-pill";
  el.style.cssText = `
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    color: #9ca3af;
  `;
  el.textContent = `⚠ ${message}`;
  return el;
}

function injectGlobalStyles() {
  if (document.getElementById("lja-styles")) return;
  const style = document.createElement("style");
  style.id = "lja-styles";
  style.textContent = `
    @keyframes lja-spin {
      to { transform: rotate(360deg); }
    }
    [${BADGE_ATTR}] {
      /* public search cards have a full-card link overlay at z-index 2 */
      position: relative;
      z-index: 3;
      margin: 6px 0;
      text-align: left;
    }
    .lja-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      line-height: 1.4;
    }
    .lja-skill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
    }
    .lja-required {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #93c5fd;
    }
    .lja-nice {
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
    }
  `;
  document.head.appendChild(style);
}

function findFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// Mounts a loading badge after `anchor`, then swaps in the result. If LinkedIn
// re-renders and drops the slot meanwhile, the next scan mounts a fresh one
// that reuses the same pending/cached analysis.
function mountBadge(
  anchor: Element,
  jobId: string,
  cardText: string,
  startExpanded = false
) {
  const slot = document.createElement("div");
  slot.setAttribute(BADGE_ATTR, jobId);
  slot.appendChild(createLoadingBadge());
  anchor.insertAdjacentElement("afterend", slot);

  requestAnalysis(jobId, cardText).then((response) => {
    if (!slot.isConnected) return;
    slot.replaceChildren(
      response.success && response.data
        ? createBadgeContainer(response.data, startExpanded)
        : createErrorBadge(response.error ?? "Analysis failed")
    );
  });
}

function processCards() {
  for (const { selector, getId } of CARD_SOURCES) {
    for (const card of Array.from(document.querySelectorAll(selector))) {
      const jobId = getId(card);
      if (!jobId) continue;

      const existing = card.querySelector(`[${BADGE_ATTR}]`);
      if (existing?.getAttribute(BADGE_ATTR) === jobId) continue;
      existing?.remove(); // node recycled for a different job

      const titleEl = findFirst(card, CARD_TITLE_SELECTORS);
      if (!titleEl) continue; // occluded card — retried once it renders

      const anchor = titleEl.closest(".artdeco-entity-lockup__title, h3, h2") ?? titleEl;
      mountBadge(anchor, jobId, extractCardText(card));
    }
  }
}

function currentDetailJobId(): string | null {
  const viewMatch = location.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/);
  if (viewMatch) return viewMatch[1];
  return new URLSearchParams(location.search).get("currentJobId");
}

// Job detail pane (search right-hand side) and standalone /jobs/view/ pages
function processDetail() {
  const jobId = currentDetailJobId();
  const titleEl = findFirst(document, DETAIL_TITLE_SELECTORS);
  if (!jobId || !titleEl) return;

  const container = titleEl.parentElement ?? titleEl;
  const existing = container.querySelector(`:scope > [${BADGE_ATTR}]`);
  if (existing?.getAttribute(BADGE_ATTR) === jobId) return;
  existing?.remove();

  mountBadge(titleEl, jobId, titleEl.textContent?.replace(/\s+/g, " ").trim() ?? "", true);
}

function scan() {
  if (!location.pathname.startsWith("/jobs")) return;
  processCards();
  processDetail();
}

injectGlobalStyles();
scan();

// LinkedIn is an SPA that mutates constantly — debounce rescans
let scanTimer: number | undefined;
const observer = new MutationObserver(() => {
  clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, 300);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
