const status = document.getElementById("status");
const uiLangEl = document.getElementById("uiLang");
let uiLang = "auto";

function applyUi() {
  document.getElementById("appName").textContent = t(uiLang, "appName");
  document.getElementById("labelUiLang").textContent = t(uiLang, "labelUiLang");
  document.getElementById("popupDesc").textContent = t(uiLang, "popupDesc");
  document.getElementById("start").textContent = t(uiLang, "start");
  document.getElementById("hint").textContent = t(uiLang, "hint");
  fillLangs();
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

chrome.storage.local.get({ uiLang: "auto" }).then((stored) => {
  uiLang = stored.uiLang || "auto";
  applyUi();
});

uiLangEl.addEventListener("change", async () => {
  uiLang = uiLangEl.value || "auto";
  await chrome.storage.local.set({ uiLang });
  applyUi();
});

document.getElementById("start").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isX(tab.url)) {
    status.textContent = t(uiLang, "openX");
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "BLUEBACK_START" });
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
