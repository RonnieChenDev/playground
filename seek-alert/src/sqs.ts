import {
  SQSClient,
  CreateQueueCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import { PendingJob } from "./types";
import { sanitizeFileName } from "./persistence/paths";

// 汇总（digest）模式下"待发职位"用 AWS SQS 存储，而不是本地文件：
// - enqueuePendingJobs：新筛出的合格职位塞进队列
// - drainPendingJobs：到了汇总发送时间点时，把队列里攒的全部职位取出并删除

export const AWS_REGION = process.env.AWS_REGION ?? "ap-southeast-2";
const sqsClient = new SQSClient({ region: AWS_REGION });

export async function getOrCreateDigestQueueUrl(
  profileName: string,
): Promise<string> {
  const queueName = `seek-alert-digest-${sanitizeFileName(profileName)}`;
  const res = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        MessageRetentionPeriod: String(14 * 24 * 60 * 60), // 14 天
      },
    }),
  );
  if (!res.QueueUrl) {
    throw new Error(`Failed to resolve SQS queue URL for "${queueName}"`);
  }
  return res.QueueUrl;
}

export async function enqueuePendingJobs(
  queueUrl: string,
  jobs: PendingJob[],
): Promise<void> {
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);
    await sqsClient.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((job, idx) => ({
          Id: `${i + idx}`,
          MessageBody: JSON.stringify(job),
        })),
      }),
    );
  }
}

export async function drainPendingJobs(
  queueUrl: string,
): Promise<PendingJob[]> {
  const jobs: PendingJob[] = [];
  for (let iterations = 0; iterations < 50; iterations++) {
    const res = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );
    const messages = res.Messages ?? [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      try {
        jobs.push(JSON.parse(msg.Body ?? "{}"));
      } catch (err) {
        console.error("❌ [Digest] Failed to parse SQS message body:", err);
      }
    }

    await sqsClient.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: messages.map((msg, idx) => ({
          Id: `${idx}`,
          ReceiptHandle: msg.ReceiptHandle!,
        })),
      }),
    );
  }
  return jobs;
}
