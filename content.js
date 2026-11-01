const PANEL_ID = "blueback-panel";
const SKIP = new Set([
  "home",
  "explore",
  "search",
  "notifications",
  "messages",
  "i",
  "settings",
  "compose",
  "tos",
  "privacy",
  "login",
  "signup",
  "following",
  "followers",
  "verified_followers",
  "status",
  "photo",
  "header_photo",
  "highlights",
  "articles",
  "media",
  "likes",
  "with_replies",
]);

const FOLLOWS_YOU = /follows you|关注了你|已关注你|已關注你|フォローされています|folgt dir|vous suit|te sigue|나를 팔로우/i;
const NOT_BLUE = /government|政府|官方|组织认证|企業|business|gold verified|gray|grey|government organization|official/i;

let running = false;
let stopFlag = false;
let currentMissing = [];
let unfollowing = false;
let uiLang = "auto";

try {
  chrome.storage.local.get({ uiLang: "auto" }).then((stored) => {
    uiLang = stored.uiLang || "auto";
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.uiLang) {
      uiLang = changes.uiLang.newValue || "auto";
      refreshPanelChrome();
    }
  });
} catch {
  /* ignore */
}

function tt(key, vars) {
  return t(uiLang, key, vars);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BLUEBACK_START") void start();
});

async function start() {
  if (running) {
    showPanel();
    setStatus(tt("alreadyRunning"));
    return;
  }
  running = true;
  stopFlag = false;
  showPanel();
    setStatus(tt("openingList"));
  renderList([]);

  try {
    if (!onFollowingPage()) {
      const profile = myProfilePath();
      if (!profile) throw new Error(tt("noProfile"));
      sessionStorage.setItem("blueback-run", "1");
      location.assign(`${profile}/following`);
      return;
    }
    await scanFollowing();
  } catch (err) {
    setStatus(String(err?.message || err));
  } finally {
    running = false;
  }
}

function onFollowingPage() {
  return /\/following\/?(\?|$)/i.test(location.pathname);
}

function myProfilePath() {
  const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  if (link?.pathname && link.pathname !== "/") return link.pathname.replace(/\/$/, "");
  const match = location.pathname.match(/^\/([A-Za-z0-9_]+)\/following\/?$/);
  if (match && !SKIP.has(match[1].toLowerCase())) return `/${match[1]}`;
  return "";
}

async function scanFollowing() {
  const seen = new Map();
  let stable = 0;
  let lastCount = 0;
  let lastHeight = 0;

  setStatus(tt("scanning"));
  harvest(seen);
  updateProgress(seen);

  while (!stopFlag && stable < 8) {
    const column = document.querySelector('[data-testid="primaryColumn"]') || document.scrollingElement;
    column.scrollTo({ top: column.scrollHeight, behavior: "instant" });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await wait(850);

    harvest(seen);
    updateProgress(seen);

    const height = document.documentElement.scrollHeight;
    if (seen.size === lastCount && height === lastHeight) stable += 1;
    else stable = 0;
    lastCount = seen.size;
    lastHeight = height;
  }

  const missing = [...seen.values()].filter((user) => !user.followsYou).sort((a, b) => a.handle.localeCompare(b.handle));
  renderList(missing);
  setStatus(
    stopFlag
      ? tt("stopped", { blue: seen.size, missing: missing.length })
      : tt("done", { blue: seen.size, missing: missing.length })
  );
}

function harvest(seen) {
  for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
    const user = parseCell(cell);
    if (!user || !user.blue) continue;
    const prev = seen.get(user.handle);
    if (prev) prev.followsYou = prev.followsYou || user.followsYou;
    else seen.set(user.handle, user);
  }
}

function parseCell(cell) {
  const handle = readHandle(cell);
  if (!handle) return null;
  const name =
    cell.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() ||
    handle;
  return {
    handle,
    name,
    blue: isBlueVerified(cell),
    followsYou: followsYou(cell),
  };
}

function readHandle(cell) {
  const links = [...cell.querySelectorAll('a[href^="/"]')];
  for (const link of links) {
    const path = (link.getAttribute("href") || "").split("?")[0];
    const part = path.split("/").filter(Boolean)[0] || "";
    if (!part || SKIP.has(part.toLowerCase())) continue;
    if (!/^[A-Za-z0-9_]{1,15}$/.test(part)) continue;
    return part;
  }
  return "";
}

function isBlueVerified(cell) {
  const badge =
    cell.querySelector('[data-testid="icon-verified"]') ||
    [...cell.querySelectorAll("svg")].find((svg) => /verified|认证|認証|인증/i.test(svg.getAttribute("aria-label") || ""));
  if (!badge) return false;
  const label = `${badge.getAttribute("aria-label") || ""} ${badge.closest("span")?.getAttribute("aria-label") || ""}`;
  if (NOT_BLUE.test(label)) return false;
  return true;
}

function followsYou(cell) {
  if (cell.querySelector('[data-testid="userFollowIndicator"]')) return true;
  const text = cell.textContent || "";
  return FOLLOWS_YOU.test(text);
}

function showPanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <header>
      <strong data-role="title"></strong>
      <div class="actions">
        <button type="button" data-act="copy"></button>
        <button type="button" data-act="stop"></button>
        <button type="button" data-act="close"></button>
      </div>
    </header>
    <p class="status"></p>
    <ol class="list"></ol>
  `;
  panel.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "top:16px",
    "right:16px",
    "width:min(360px, calc(100vw - 32px))",
    "max-height:min(70vh, 560px)",
    "overflow:auto",
    "background:#10141c",
    "color:#f4f1ea",
    "border:1px solid #2a3346",
    "border-radius:16px",
    "padding:12px",
    "box-shadow:0 16px 40px rgba(0,0,0,.35)",
    "font:13px/1.45 Segoe UI,system-ui,sans-serif",
  ].join(";");
  panel.querySelector("header").style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;";
  panel.querySelector(".actions").style.cssText = "display:flex;gap:6px;";
  for (const button of panel.querySelectorAll("button")) {
    button.style.cssText =
      "border:1px solid #2a3346;background:#171d2a;color:#f4f1ea;border-radius:999px;padding:4px 8px;cursor:pointer;";
  }
  panel.querySelector(".status").style.cssText = "margin:0 0 8px;color:#9aa3b5;";
  panel.querySelector(".list").style.cssText = "margin:0;padding-left:18px;max-height:420px;overflow:auto;";
  panel.addEventListener("click", onPanelClick);
  document.documentElement.appendChild(panel);
  refreshPanelChrome();
  return panel;
}

function refreshPanelChrome() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const title = panel.querySelector("[data-role='title']");
  if (title) title.textContent = tt("panelTitle");
  const copy = panel.querySelector("[data-act='copy']");
  const stop = panel.querySelector("[data-act='stop']");
  const close = panel.querySelector("[data-act='close']");
  if (copy) copy.textContent = tt("copy");
  if (stop) stop.textContent = tt("stop");
  if (close) close.textContent = tt("close");
  if (panel.querySelector(".status") && !panel.querySelector(".status").textContent) {
    panel.querySelector(".status").textContent = tt("preparing");
  }
  renderList(currentMissing);
}

function onPanelClick(event) {
  const act = event.target?.dataset?.act;
  if (act === "close") document.getElementById(PANEL_ID)?.remove();
  if (act === "stop") stopFlag = true;
  if (act === "copy") {
    const lines = [...document.querySelectorAll(`#${PANEL_ID} .list a`)].map((a) => `@${a.dataset.handle} ${a.dataset.name}`);
    navigator.clipboard.writeText(lines.join("\n")).then(() => setStatus(tt("copied", { count: lines.length })));
  }
  if (act === "unfollow" && event.target.dataset.handle) {
    void unfollowOne(event.target.dataset.handle);
  }
}

function setStatus(text) {
  const node = document.querySelector(`#${PANEL_ID} .status`);
  if (node) node.textContent = text;
}

function updateProgress(seen) {
  const missing = [...seen.values()].filter((user) => !user.followsYou).length;
  setStatus(tt("progress", { blue: seen.size, missing }));
  renderList([...seen.values()].filter((user) => !user.followsYou));
}

function renderList(users) {
  currentMissing = users;
  const list = document.querySelector(`#${PANEL_ID} .list`);
  if (!list) return;
  list.replaceChildren();
  for (const user of users) {
    const item = document.createElement("li");
    item.style.cssText = "margin:0 0 8px;display:flex;gap:8px;align-items:center;justify-content:space-between;";
    const link = document.createElement("a");
    link.href = `/${user.handle}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.dataset.handle = user.handle;
    link.dataset.name = user.name;
    link.textContent = `${user.name} @${user.handle}`;
    link.style.cssText = "color:#1d9bf0;flex:1;min-width:0;";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = "unfollow";
    button.dataset.handle = user.handle;
    button.textContent = tt("unfollow");
    button.style.cssText =
      "border:1px solid #2a3346;background:#171d2a;color:#f4f1ea;border-radius:999px;padding:4px 8px;cursor:pointer;flex:none;";
    item.appendChild(link);
    item.appendChild(button);
    list.appendChild(item);
  }
}

function findCell(handle) {
  const needle = handle.toLowerCase();
  for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
    if (readHandle(cell)?.toLowerCase() === needle) return cell;
  }
  return null;
}

async function unfollowOne(handle) {
  if (unfollowing) return;
  unfollowing = true;
  try {
    const cell = findCell(handle);
    if (!cell) {
      setStatus(tt("notOnPage", { handle }));
      return;
    }
    const button =
      cell.querySelector(`[data-testid="${handle}-unfollow"]`) ||
      cell.querySelector(`[data-testid="${handle.toLowerCase()}-unfollow"]`) ||
      cell.querySelector('[data-testid$="-unfollow"]') ||
      [...cell.querySelectorAll("button")].find((node) =>
        /unfollow|following @|正在关注|已关注/i.test(`${node.getAttribute("aria-label") || ""} ${node.textContent || ""}`)
      );
    if (!button) {
      setStatus(tt("noButton", { handle }));
      return;
    }
    button.click();
    await wait(350);
    document.querySelector('[data-testid="confirmationSheetConfirm"]')?.click();
    currentMissing = currentMissing.filter((user) => user.handle.toLowerCase() !== handle.toLowerCase());
    renderList(currentMissing);
    setStatus(tt("unfollowed", { handle, left: currentMissing.length }));
  } finally {
    unfollowing = false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (sessionStorage.getItem("blueback-run") === "1" && onFollowingPage()) {
  sessionStorage.removeItem("blueback-run");
  window.setTimeout(() => void start(), 1200);
}
