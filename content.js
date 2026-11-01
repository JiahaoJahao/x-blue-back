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
const DAY_OPTIONS = [0, 3, 5, 7];

let running = false;
let stopFlag = false;
let currentMissing = [];
let lastMissing = [];
let unfollowing = false;
let uiLang = "auto";
let minDays = 3;
let followTimes = {};
let gqlUsers = new Map();

try {
  chrome.storage.local.get({ uiLang: "auto", minDays: 3, followTimes: {} }).then((stored) => {
    uiLang = stored.uiLang || "auto";
    followTimes = stored.followTimes || {};
    const saved = Number(sessionStorage.getItem("blueback-days") || stored.minDays);
    if (DAY_OPTIONS.includes(saved)) minDays = saved;
    refreshPanelChrome();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.uiLang) {
      uiLang = changes.uiLang.newValue || "auto";
      refreshPanelChrome();
    }
    if (changes.minDays && DAY_OPTIONS.includes(Number(changes.minDays.newValue))) {
      minDays = Number(changes.minDays.newValue);
      refreshPanelChrome();
      renderFromCache();
    }
  });
} catch {
  /* ignore */
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data?.__blueback || !Array.isArray(event.data.users)) return;
  mergeGraphql(event.data.users);
});

function tt(key, vars) {
  return t(uiLang, key, vars);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "BLUEBACK_START") return;
  const next = Number(message.minDays);
  if (DAY_OPTIONS.includes(next)) {
    minDays = next;
    sessionStorage.setItem("blueback-days", String(minDays));
    try {
      chrome.storage.local.set({ minDays });
    } catch {
      /* ignore */
    }
  }
  void start({ fromFreshLoad: false });
});

async function start(options = {}) {
  const fromFreshLoad = !!options.fromFreshLoad;
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
      sessionStorage.setItem("blueback-days", String(minDays));
      location.assign(`${profile}/following`);
      return;
    }
    if (!fromFreshLoad) {
      sessionStorage.setItem("blueback-run", "1");
      sessionStorage.setItem("blueback-days", String(minDays));
      location.reload();
      return;
    }
    await waitForList();
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

  const missing = missingFrom(seen);
  lastMissing = missing;
  const shown = dueFrom(missing);
  renderList(shown);
  persistFollowTimes();
  setStatus(
    tt(
      stopFlag ? "stopped" : "done",
      statusVars({
        blue: seen.size,
        missing: missing.length,
        shown: shown.length,
        young: missing.length - shown.length,
      })
    )
  );
}

function harvest(seen) {
  for (const cell of document.querySelectorAll('[data-testid="UserCell"]')) {
    const user = parseCell(cell);
    if (!user || !user.blue) continue;
    rememberUser(seen, user);
  }
  for (const user of gqlUsers.values()) {
    if (!user.blue) continue;
    rememberUser(seen, user);
  }
}

function rememberUser(seen, user) {
  const key = user.handle.toLowerCase();
  const prev = seen.get(key);
  const followedAt = user.followedAt || prev?.followedAt || followTimes[key] || 0;
  if (followedAt) followTimes[key] = followedAt;
  else if (!followTimes[key]) followTimes[key] = Date.now();
  seen.set(key, {
    handle: user.handle,
    name: user.name || prev?.name || user.handle,
    blue: true,
    followsYou: !!(prev?.followsYou || user.followsYou),
    followedAt: followTimes[key],
  });
}

function mergeGraphql(users) {
  let changed = false;
  for (const user of users) {
    if (!user?.handle) continue;
    const key = user.handle.toLowerCase();
    const prev = gqlUsers.get(key);
    const followedAt = user.followedAt || prev?.followedAt || 0;
    gqlUsers.set(key, {
      handle: user.handle,
      name: user.name || prev?.name || user.handle,
      blue: !!(user.blue || prev?.blue),
      followsYou: !!(user.followsYou || prev?.followsYou),
      followedAt,
    });
    if (followedAt && followTimes[key] !== followedAt) {
      followTimes[key] = followedAt;
      changed = true;
    }
  }
  if (changed) persistFollowTimes();
  if (!lastMissing.length) return;
  lastMissing = lastMissing
    .map((user) => {
      const key = user.handle.toLowerCase();
      const gql = gqlUsers.get(key);
      return {
        ...user,
        followsYou: !!(user.followsYou || gql?.followsYou),
        followedAt: gql?.followedAt || followTimes[key] || user.followedAt,
      };
    })
    .filter((user) => user.blue && !user.followsYou)
    .sort((a, b) => daysFollowed(b) - daysFollowed(a) || a.handle.localeCompare(b.handle));
  const shown = dueFrom(lastMissing);
  renderList(shown);
}

function persistFollowTimes() {
  try {
    chrome.storage.local.set({ followTimes });
  } catch {
    /* ignore */
  }
}

function parseCell(cell) {
  const handle = readHandle(cell);
  if (!handle) return null;
  const key = handle.toLowerCase();
  const gql = gqlUsers.get(key);
  const name =
    cell.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() ||
    gql?.name ||
    handle;
  return {
    handle,
    name,
    blue: isBlueVerified(cell) || !!gql?.blue,
    followsYou: followsYou(cell) || !!gql?.followsYou,
    followedAt: gql?.followedAt || followTimes[key] || 0,
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

function followedAtOf(user) {
  return user.followedAt || followTimes[user.handle.toLowerCase()] || 0;
}

function daysFollowed(user) {
  const ts = followedAtOf(user);
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function isOverDays(user, days) {
  const ts = followedAtOf(user);
  if (!ts) return false;
  return Date.now() - ts > days * 86400000;
}

function missingFrom(seen) {
  return [...seen.values()]
    .filter((user) => user.blue && !user.followsYou)
    .sort((a, b) => daysFollowed(b) - daysFollowed(a) || a.handle.localeCompare(b.handle));
}

function isRealtime() {
  return minDays === 0;
}

function dueFrom(missing, days = minDays) {
  if (days === 0) return missing;
  return missing.filter((user) => isOverDays(user, days));
}

function statusVars(extra = {}) {
  return {
    blue: extra.blue ?? 0,
    missing: extra.missing ?? 0,
    shown: extra.shown ?? 0,
    young: extra.young ?? 0,
    min: minDays,
    mode: isRealtime() ? tt("days0") : tt(`days${minDays}`),
  };
}

function showPanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) {
    refreshPanelChrome();
    return panel;
  }
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
    <div class="filters"></div>
    <p class="warn"></p>
    <p class="status"></p>
    <ol class="list"></ol>
  `;
  panel.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "top:16px",
    "right:16px",
    "width:min(380px, calc(100vw - 32px))",
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
  panel.querySelector(".filters").style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;";
  panel.querySelector(".warn").style.cssText = "margin:0 0 8px;color:#ff4d4f;font-weight:650;";
  for (const button of panel.querySelectorAll("button")) {
    styleChip(button, false);
  }
  panel.querySelector(".status").style.cssText = "margin:0 0 8px;color:#9aa3b5;";
  panel.querySelector(".list").style.cssText = "margin:0;padding-left:18px;max-height:420px;overflow:auto;";
  panel.addEventListener("click", onPanelClick);
  document.documentElement.appendChild(panel);
  refreshPanelChrome();
  return panel;
}

function styleChip(button, active) {
  button.style.cssText = active
    ? "border:1px solid #1d9bf0;background:#1d9bf0;color:#fff;border-radius:999px;padding:4px 8px;cursor:pointer;"
    : "border:1px solid #2a3346;background:#171d2a;color:#f4f1ea;border-radius:999px;padding:4px 8px;cursor:pointer;";
}

function refreshPanelChrome() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const title = panel.querySelector("[data-role='title']");
  if (title) title.textContent = isRealtime() ? tt("panelTitleLive") : tt("panelTitle", { min: minDays });
  const warn = panel.querySelector(".warn");
  if (warn) warn.textContent = tt("liveWarn");
  const copy = panel.querySelector("[data-act='copy']");
  const stop = panel.querySelector("[data-act='stop']");
  const close = panel.querySelector("[data-act='close']");
  if (copy) copy.textContent = tt("copy");
  if (stop) stop.textContent = tt("stop");
  if (close) close.textContent = tt("close");
  const filters = panel.querySelector(".filters");
  if (filters) {
    filters.replaceChildren();
    for (const days of DAY_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.act = "days";
      button.dataset.days = String(days);
      button.textContent = tt(`days${days}`);
      styleChip(button, days === minDays);
      filters.appendChild(button);
    }
  }
  if (panel.querySelector(".status") && !panel.querySelector(".status").textContent) {
    panel.querySelector(".status").textContent = tt("preparing");
  }
  renderList(currentMissing);
}

function onPanelClick(event) {
  const act = event.target?.dataset?.act;
  if (act === "close") document.getElementById(PANEL_ID)?.remove();
  if (act === "stop") stopFlag = true;
  if (act === "days") {
    const next = Number(event.target.dataset.days);
    if (!DAY_OPTIONS.includes(next)) return;
    minDays = next;
    sessionStorage.setItem("blueback-days", String(minDays));
    try {
      chrome.storage.local.set({ minDays });
    } catch {
      /* ignore */
    }
    const shown = dueFrom(lastMissing);
    renderList(shown);
    refreshPanelChrome();
    setStatus(tt("filtered", statusVars({ missing: lastMissing.length, shown: shown.length, young: lastMissing.length - shown.length })));
  }
  if (act === "copy") {
    const lines = [...document.querySelectorAll(`#${PANEL_ID} .list a`)].map(
      (a) => `@${a.dataset.handle} ${a.dataset.name} ${a.dataset.days}d`
    );
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
  persistFollowTimes();
  const missing = missingFrom(seen);
  lastMissing = missing;
  const shown = dueFrom(missing);
  setStatus(
    tt(
      "progress",
      statusVars({
        blue: seen.size,
        missing: missing.length,
        shown: shown.length,
        young: missing.length - shown.length,
      })
    )
  );
  renderList(shown);
}

function renderFromCache() {
  const shown = dueFrom(lastMissing);
  renderList(shown);
}

function renderList(users) {
  currentMissing = users;
  const list = document.querySelector(`#${PANEL_ID} .list`);
  if (!list) return;
  list.replaceChildren();
  for (const user of users) {
    const days = daysFollowed(user);
    const item = document.createElement("li");
    item.style.cssText = "margin:0 0 8px;display:flex;gap:8px;align-items:center;justify-content:space-between;";
    const link = document.createElement("a");
    link.href = `/${user.handle}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.dataset.handle = user.handle;
    link.dataset.name = user.name;
    link.dataset.days = String(days);
    link.textContent = `${user.name} @${user.handle}`;
    link.style.cssText = "color:#1d9bf0;flex:1;min-width:0;";
    const meta = document.createElement("span");
    meta.textContent = tt("dayCount", { days });
    meta.style.cssText = "color:#9aa3b5;font-size:12px;flex:none;";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = "unfollow";
    button.dataset.handle = user.handle;
    button.textContent = tt("unfollow");
    button.style.cssText =
      "border:1px solid #2a3346;background:#171d2a;color:#f4f1ea;border-radius:999px;padding:4px 8px;cursor:pointer;flex:none;";
    const left = document.createElement("div");
    left.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;";
    left.appendChild(link);
    left.appendChild(meta);
    item.appendChild(left);
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
    const key = handle.toLowerCase();
    lastMissing = lastMissing.filter((user) => user.handle.toLowerCase() !== key);
    currentMissing = currentMissing.filter((user) => user.handle.toLowerCase() !== key);
    delete followTimes[key];
    persistFollowTimes();
    renderList(currentMissing);
    setStatus(tt("unfollowed", { handle, left: currentMissing.length }));
  } finally {
    unfollowing = false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForList() {
  setStatus(tt("openingList"));
  for (let i = 0; i < 25; i += 1) {
    if (document.querySelector('[data-testid="UserCell"]')) {
      await wait(400);
      return;
    }
    await wait(250);
  }
}

async function maybeAutostart() {
  let shouldStart = sessionStorage.getItem("blueback-run") === "1";
  sessionStorage.removeItem("blueback-run");
  try {
    const stored = await chrome.storage.local.get({ pendingScan: false, minDays: 3 });
    if (stored.pendingScan) {
      shouldStart = true;
      await chrome.storage.local.set({ pendingScan: false });
    }
    const saved = Number(sessionStorage.getItem("blueback-days") || stored.minDays);
    if (DAY_OPTIONS.includes(saved)) minDays = saved;
  } catch {
    /* ignore */
  }
  if (!shouldStart) return;
  window.setTimeout(() => void start({ fromFreshLoad: onFollowingPage() }), 800);
}

void maybeAutostart();
