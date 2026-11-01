export interface UserProfile {
  skills: string[];
  experience: string[];
  visaStatus: "citizen" | "pr" | "work_visa" | "student_visa" | "other";
  // Jobs matching these are skipped before calling the API (whole-word, case-insensitive)
  excludedLocations?: string[];
  excludedTitleKeywords?: string[];
}

export interface JobAnalysis {
  jobType: string;
  location: string;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  fitScore: "green" | "yellow" | "red";
  fitReason: string;
  citizenshipRequired:
    | "citizen_only"
    | "pr_or_citizen"
    | "any_work_rights"
    | "unknown";
  visaStatus?: string;
  experienceLevel: "junior" | "mid" | "senior" | "unknown";
  candidateExperience?: string[];
}

export interface AnalysisRequest {
  jobText: string;
  userProfile: UserProfile;
}

export interface AnalyseJobMessage {
  type: "ANALYSE_JOB";
  jobId: string;
  // Title / company / location scraped from the card, used as context and
  // as a fallback when the full description can't be fetched.
  cardText: string;
}

export interface AnalysisResponse {
  success: boolean;
  data?: JobAnalysis;
  error?: string;
}

export interface CachedAnalysis {
  analysis: JobAnalysis;
  profileSig: string;
  at: number;
}
