import { ClassifyResult, Job } from "./types";

export async function classifyJobWithClaude(
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
