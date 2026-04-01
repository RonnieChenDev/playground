export interface UserProfile {
  skills: string[];
  experience: string[];
  visaStatus: "citizen" | "pr" | "work_visa" | "student_visa" | "other";
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

export interface AnalysisResponse {
  success: boolean;
  data?: JobAnalysis;
  error?: string;
}