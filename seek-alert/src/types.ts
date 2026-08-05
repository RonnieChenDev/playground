export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  listedAt: string;
}

export interface SmtpConfig {
  emailUser: string;
  emailAppPassword: string;
}

export interface AiFilterConfig {
  enabled: boolean;
  model?: string;
  unwantedCriteria: string[];
}

export interface DeliveryConfig {
  mode: "realtime" | "digest";
  digestTimes: string[]; // "HH:mm", Perth time. Only used when mode === "digest".
}

export interface Profile {
  name: string;
  emailTo: string;
  emailSubjectPrefix?: string;
  seekUrls: string[];
  seekCheckIntervalMs: number;
  titleExcludeKeywords?: string[];
  aiFilter?: AiFilterConfig;
  delivery: DeliveryConfig;
}

export interface AppConfig {
  smtp: SmtpConfig;
  anthropicApiKey?: string;
  profiles: Profile[];
}

export interface RejectedJob extends Job {
  reason: string;
  filteredBy: "keyword" | "ai";
  rejectedAt: string;
}

export interface PendingJob extends Job {
  label: string;
  foundAt: string;
}

export interface DigestState {
  date: string; // "YYYY-MM-DD", Perth time
  firedTimes: string[]; // "HH:mm" entries already sent today
}

export interface EmailGroup {
  label: string;
  jobs: Job[];
}

export interface ClassifyResult {
  reject: boolean;
  reason: string;
}
