export interface UserProfile {
  skills: string[];        // techstack preferred of the user
  experience: string;      // e.g. "junior", "mid", "senior"
}

export interface JobAnalysis {
  jobType: string;         // e.g. "Full Stack Developer"
  location: string;        // e.g. "Perth WA"
  requiredSkills: string[];
  niceToHaveSkills: string[];
  fitScore: "green" | "yellow" | "red";
  fitReason: string;       // e.g. "Matches 4/5 core skills"
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