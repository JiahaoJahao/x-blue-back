const status = document.getElementById("status");
const uiLangEl = document.getElementById("uiLang");
const minDaysEl = document.getElementById("minDays");
const DAY_OPTIONS = [0, 3, 5, 7];
let uiLang = "auto";
let minDays = 3;

function applyUi() {
  document.getElementById("appName").textContent = t(uiLang, "appName");
  document.getElementById("labelUiLang").textContent = t(uiLang, "labelUiLang");
  document.getElementById("labelMinDays").textContent = t(uiLang, "labelMinDays");
  document.getElementById("liveWarn").textContent = t(uiLang, "liveWarn");
  document.getElementById("popupDesc").textContent = t(uiLang, "popupDesc");
  document.getElementById("start").textContent = t(uiLang, "start");
  document.getElementById("hint").textContent = t(uiLang, "hint");
  fillLangs();
  fillDays();
}

function fillLangs() {
  uiLangEl.replaceChildren();
  for (const item of UI_LANGS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.id === "auto" ? `${t(uiLang, "autoLang")} / Auto` : item.native;
    uiLangEl.appendChild(option);
  }
  uiLangEl.value = uiLang;
}

function fillDays() {
  for (const option of minDaysEl.options) {
    option.textContent = t(uiLang, `days${option.value}`);
  }
  minDaysEl.value = String(minDays);
}

function readDays(value) {
  const next = Number(value);
  return DAY_OPTIONS.includes(next) ? next : 3;
}

chrome.storage.local.get({ uiLang: "auto", minDays: 3 }).then((stored) => {
  uiLang = stored.uiLang || "auto";
  minDays = readDays(stored.minDays);
  applyUi();
});

uiLangEl.addEventListener("change", async () => {
  uiLang = uiLangEl.value || "auto";
  await chrome.storage.local.set({ uiLang });
  applyUi();
});

minDaysEl.addEventListener("change", async () => {
  minDays = readDays(minDaysEl.value);
  await chrome.storage.local.set({ minDays });
});

document.getElementById("start").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isX(tab.url)) {
    status.textContent = t(uiLang, "openX");
    return;
  }
  try {
    minDays = readDays(minDaysEl.value);
    await chrome.storage.local.set({ minDays, pendingScan: true });
    try {
      await chrome.tabs.reload(tab.id);
    } catch {
      await chrome.tabs.sendMessage(tab.id, { type: "BLUEBACK_START", minDays });
    }
    window.close();
  } catch {
    status.textContent = t(uiLang, "notReady");
  }
});

function isX(url) {
  try {
    const host = new URL(url).hostname;
    return host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com");
  } catch {
    return false;
  }
}
