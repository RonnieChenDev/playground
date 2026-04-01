import { JobAnalysis, AnalysisResponse } from "./types";

const JOB_CARD_SELECTOR = '[data-testid="job-card"]';
const JOB_TITLE_SELECTOR = '[data-testid="job-title"]';
const JOB_LOCATION_SELECTOR = '[data-testid="job-location"]';

const analysedCards = new WeakSet<Element>();

function extractJobText(card: Element): string {
  return card.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function createBadgeContainer(analysis: JobAnalysis): HTMLElement {
  const container = document.createElement("div");
  container.className = "sja-badge-container";

  const colorMap = {
    green: { bg: "#dcfce7", border: "#16a34a", text: "#15803d", dot: "#16a34a" },
    yellow: { bg: "#fef9c3", border: "#ca8a04", text: "#a16207", dot: "#ca8a04" },
    red: { bg: "#fee2e2", border: "#dc2626", text: "#b91c1c", dot: "#dc2626" }
  };
  const colors = colorMap[analysis.fitScore];

  const badge = document.createElement("div");
  badge.className = "sja-badge";
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
    color: ${colors.text};
    margin-bottom: 6px;
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
  detail.className = "sja-detail";
  detail.style.cssText = `
    display: none;
    margin-top: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid ${colors.border};
    background: ${colors.bg};
    font-size: 12px;
    color: #374151;
    line-height: 1.6;
  `;

  const requiredHtml = analysis.requiredSkills
    .map(s => `<span class="sja-skill sja-required">${s}</span>`)
    .join("");
  const niceHtml = analysis.niceToHaveSkills
    .map(s => `<span class="sja-skill sja-nice">${s}</span>`)
    .join("");

  detail.innerHTML = `
    <div style="margin-bottom:6px">
      <strong>Role:</strong> ${analysis.jobType} &nbsp;·&nbsp;
      <strong>Location:</strong> ${analysis.location}
    </div>
    <div style="margin-bottom:4px">
      <strong>Required:</strong><br/>
      <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px">${requiredHtml}</div>
    </div>
    ${niceHtml ? `
    <div style="margin-top:6px">
      <strong>Nice to have:</strong><br/>
      <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px">${niceHtml}</div>
    </div>` : ""}
  `;

  let expanded = false;
  badge.addEventListener("click", () => {
    expanded = !expanded;
    detail.style.display = expanded ? "block" : "none";
  });

  container.appendChild(badge);
  container.appendChild(detail);
  return container;
}

function createLoadingBadge(): HTMLElement {
  const el = document.createElement("div");
  el.className = "sja-loading";
  el.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    border: 1px solid #d1d5db;
    background: #f9fafb;
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 6px;
  `;
  el.innerHTML = `
    <span style="
      width:8px;height:8px;border-radius:50%;
      border:2px solid #9ca3af;
      border-top-color:transparent;
      animation:sja-spin 0.7s linear infinite;
      flex-shrink:0;
    "></span>
    Analysing…
  `;
  return el;
}

function createErrorBadge(message: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    font-size: 12px;
    color: #9ca3af;
    margin-bottom: 6px;
  `;
  el.textContent = `⚠ ${message}`;
  return el;
}

function injectGlobalStyles() {
  if (document.getElementById("sja-styles")) return;
  const style = document.createElement("style");
  style.id = "sja-styles";
  style.textContent = `
    @keyframes sja-spin {
      to { transform: rotate(360deg); }
    }
    .sja-skill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
    }
    .sja-required {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #93c5fd;
    }
    .sja-nice {
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
    }
  `;
  document.head.appendChild(style);
}

async function analyseCard(card: Element): Promise<void> {
  if (analysedCards.has(card)) return;
  analysedCards.add(card);

  const titleEl = card.querySelector(JOB_TITLE_SELECTOR) ?? card.querySelector("h3");
  if (!titleEl) return;

  const insertTarget = titleEl.closest("div") ?? titleEl.parentElement;
  if (!insertTarget) return;

  const loading = createLoadingBadge();
  insertTarget.insertAdjacentElement("afterend", loading);

  const jobText = extractJobText(card);

  const response = await new Promise<AnalysisResponse>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "ANALYSE_JOB", jobText },
      (res: AnalysisResponse) => resolve(res)
    );
  });

  loading.remove();

  if (!response.success || !response.data) {
    const errBadge = createErrorBadge(response.error ?? "Analysis failed");
    insertTarget.insertAdjacentElement("afterend", errBadge);
    return;
  }

  const badge = createBadgeContainer(response.data);
  insertTarget.insertAdjacentElement("afterend", badge);
}

function analyseAllVisibleCards() {
  const cards = Array.from(document.querySelectorAll(JOB_CARD_SELECTOR))
    .filter(card => !analysedCards.has(card));

  // interval 1.5s
  let chain = Promise.resolve();
  for (const card of cards) {
    chain = chain.then(() => analyseCard(card)).then(
      () => new Promise(res => setTimeout(res, 3000))
    );
  }
}

injectGlobalStyles();
analyseAllVisibleCards();

const observer = new MutationObserver(() => {
  analyseAllVisibleCards();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});