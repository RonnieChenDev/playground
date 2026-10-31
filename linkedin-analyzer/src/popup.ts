chrome.storage.sync.get(["apiKey", "userProfile"], (stored) => {
  const keyDot = document.getElementById("key-dot") as HTMLElement;
  const keyLabel = document.getElementById("key-label") as HTMLElement;
  const profileDot = document.getElementById("profile-dot") as HTMLElement;
  const profileLabel = document.getElementById("profile-label") as HTMLElement;

  if (stored.apiKey) {
    keyDot.className = "dot ok";
    keyLabel.textContent = "API key configured";
  } else {
    keyDot.className = "dot warn";
    keyLabel.textContent = "No API key set";
  }

  if (stored.userProfile?.skills?.length > 0) {
    profileDot.className = "dot ok";
    profileLabel.textContent = `${stored.userProfile.skills.length} skills in profile`;
  } else {
    profileDot.className = "dot warn";
    profileLabel.textContent = "No skills profile set";
  }
});

const enabledToggle = document.getElementById("enabled-toggle") as HTMLInputElement;
const enabledLabel = document.getElementById("enabled-label") as HTMLElement;

function renderEnabled(paused: boolean) {
  enabledToggle.checked = !paused;
  enabledLabel.textContent = paused ? "Analysis paused" : "Analysis on";
}

chrome.storage.sync.get("paused", (stored) => renderEnabled(!!stored.paused));

enabledToggle.addEventListener("change", () => {
  const paused = !enabledToggle.checked;
  renderEnabled(paused);
  chrome.storage.sync.set({ paused });
});

const link = document.getElementById("options-link");
if (link) {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}