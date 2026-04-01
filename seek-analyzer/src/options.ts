import { UserProfile } from "./types";

const form = document.getElementById("options-form") as HTMLFormElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const skillsInput = document.getElementById("skills") as HTMLInputElement;
const experienceSelect = document.getElementById("experience") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLElement;

function showStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#dc2626" : "#16a34a";
  setTimeout(() => { statusEl.textContent = ""; }, 3000);
}

chrome.storage.sync.get(["apiKey", "userProfile"], (stored) => {
  if (stored.apiKey) {
    apiKeyInput.value = stored.apiKey;
  }
  if (stored.userProfile) {
    const profile = stored.userProfile as UserProfile;
    skillsInput.value = profile.skills.join(", ");
    experienceSelect.value = profile.experience;
  }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey.startsWith("sk-ant-")) {
    showStatus("Invalid API key format. Should start with sk-ant-", true);
    return;
  }

  const rawSkills = skillsInput.value.trim();
  if (!rawSkills) {
    showStatus("Please enter at least one skill.", true);
    return;
  }

  const skills = rawSkills
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const userProfile: UserProfile = {
    skills,
    experience: experienceSelect.value
  };

  chrome.storage.sync.set({ apiKey, userProfile }, () => {
    showStatus("Settings saved ✓");
  });
});