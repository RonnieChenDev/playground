import { UserProfile } from "./types";

const form = document.getElementById("options-form") as HTMLFormElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const skillsInput = document.getElementById("skills") as HTMLInputElement;
const visaSelect = document.getElementById("visa-status") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLElement;

function getSelectedExperience(): string[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    'input[name="experience"]:checked',
  );
  return Array.from(checkboxes).map((cb) => cb.value);
}

function setSelectedExperience(values: string[]) {
  document
    .querySelectorAll<HTMLInputElement>('input[name="experience"]')
    .forEach((cb) => {
      cb.checked = values.includes(cb.value);
    });
}

function showStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#dc2626" : "#16a34a";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 3000);
}

chrome.storage.sync.get(["apiKey", "userProfile"], (stored) => {
  if (stored.apiKey) {
    apiKeyInput.value = stored.apiKey;
  }
  if (stored.userProfile) {
    const profile = stored.userProfile as UserProfile;
    skillsInput.value = profile.skills.join(", ");
    const exp = Array.isArray(profile.experience)
      ? profile.experience
      : [profile.experience];
    setSelectedExperience(exp);
    visaSelect.value = profile.visaStatus ?? "student_visa";
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

  const experience = getSelectedExperience();
  if (experience.length === 0) {
    showStatus("Please select at least one experience level.", true);
    return;
  }

  const skills = rawSkills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const userProfile: UserProfile = {
    skills,
    experience,
    visaStatus: visaSelect.value as UserProfile["visaStatus"],
  };

  chrome.storage.sync.set({ apiKey, userProfile }, () => {
    showStatus("Settings saved ✓");
  });
});