import * as nodemailer from "nodemailer";
import { EmailGroup, Job, SmtpConfig } from "./types";

export function createTransporter(smtp: SmtpConfig) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: smtp.emailUser, pass: smtp.emailAppPassword },
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderJobTable(jobs: Job[]): string {
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

export async function sendJobEmail(
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
