(() => {
  if (window.__bluebackHook) return;
  window.__bluebackHook = true;

  const TW_EPOCH = 1288834974657n;

  function publish(users) {
    if (!users.length) return;
    window.postMessage({ __blueback: 1, users }, "*");
  }

  function isFollowingApi(url) {
    const text = String(url || "");
    if (!/\/graphql\//i.test(text)) return false;
    if (/Followers|FollowersYouKnow|BlueVerifiedFollowers|VerifiedFollowers|FollowingRequest/i.test(text)) {
      return false;
    }
    return /\/Following(?:Latest)?(?:\?|$|\/|&)/i.test(text) || /FollowingLatest/i.test(text);
  }

  function idToTime(id) {
    if (id == null || id === "") return 0;
    try {
      const n = BigInt(String(id));
      if (n <= 0n) return 0;
      if (n < 10000000000000n) {
        const num = Number(n);
        if (num > 1e12 && num < Date.now() + 86400000) return num;
        if (num > 1e9 && num < 4e9) return num * 1000;
        return 0;
      }
      const ms = Number((n >> 22n) + TW_EPOCH);
      if (ms > 1.2e12 && ms < Date.now() + 86400000) return ms;
    } catch {
      /* ignore */
    }
    return 0;
  }

  function readUser(node) {
    if (!node || typeof node !== "object") return null;
    const result =
      node.__typename === "User"
        ? node
        : node.result?.__typename === "User"
          ? node.result
          : node.result?.legacy || node.result?.core
            ? node.result
            : null;
    if (!result) return null;
    const handle = result.core?.screen_name || result.legacy?.screen_name || "";
    if (!handle) return null;
    const verifiedType = String(result.legacy?.verified_type || result.verification_info?.type || "");
    const followsYou = !!(
      result.legacy?.followed_by ||
      result.relationship_perspectives?.followed_by ||
      result.relationship_perspectives?.followedBy
    );
    return {
      handle,
      name: result.core?.name || result.legacy?.name || handle,
      blue: !!result.is_blue_verified && !/business|government/i.test(verifiedType),
      followsYou,
    };
  }

  function collectUsers(data) {
    const found = new Map();

    function remember(user, sortIndex) {
      if (!user?.handle) return;
      const key = user.handle.toLowerCase();
      const followedAt = idToTime(sortIndex);
      const prev = found.get(key);
      found.set(key, {
        handle: user.handle,
        name: user.name || prev?.name || user.handle,
        blue: !!(user.blue || prev?.blue),
        followsYou: !!(user.followsYou || prev?.followsYou),
        followedAt: followedAt || prev?.followedAt || 0,
      });
    }

    function walkUser(node, sortIndex) {
      if (!node || typeof node !== "object") return;
      const user = readUser(node);
      if (user) remember(user, sortIndex);
      if (Array.isArray(node)) {
        for (const item of node) walkUser(item, sortIndex);
        return;
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") walkUser(value, sortIndex);
      }
    }

    function walkEntries(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) walkEntries(item);
        return;
      }
      const entryId = String(node.entryId || "");
      const itemType = node.itemContent?.itemType || node.content?.itemContent?.itemType || "";
      const displayType = String(node.displayType || node.content?.displayType || "");
      if (/sugges|whoToFollow|UserPreview/i.test(entryId + displayType)) return;
      const sortIndex = node.sortIndex != null ? String(node.sortIndex) : "";
      const isUserEntry =
        /^user-/i.test(entryId) ||
        itemType === "TimelineUser" ||
        node.itemContent?.user_results ||
        node.content?.itemContent?.user_results;
      if (isUserEntry) {
        walkUser(node, sortIndex);
        return;
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") walkEntries(value);
      }
    }

    walkEntries(data);
    return [...found.values()];
  }

  function ingest(url, raw) {
    if (!isFollowingApi(url) || !raw) return;
    try {
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      publish(collectUsers(data));
    } catch {
      /* ignore */
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    return origFetch.apply(this, args).then((res) => {
      if (isFollowingApi(url || res.url)) {
        res
          .clone()
          .json()
          .then((data) => publish(collectUsers(data)))
          .catch(() => {});
      }
      return res;
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__bluebackUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      ingest(this.__bluebackUrl || "", this.responseText);
    });
    return origSend.apply(this, args);
  };
})();
