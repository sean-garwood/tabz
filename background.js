// Tabz service worker: owns every chrome.tabs / chrome.tabGroups call.
// Stateless by design: nothing is read from or written to storage, and no
// network requests are ever made.

const NO_GROUP = -1;

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

const COMMAND_MESSAGES = {
  "move-left": { type: "move", delta: -1 },
  "move-right": { type: "move", delta: 1 },
  "create-group": { type: "createGroup" },
  "ungroup": { type: "ungroup" },
};

function groupTitleFor(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || "tabs";
  } catch {
    return "tabs";
  }
}

function groupColorFor(title) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)) % 9973;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

// Pinned tabs occupy a contiguous region at the start of the strip; a move
// must stay inside the tab's own region or Chrome rejects it.
function moveBounds(tabs, tab) {
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  return tab.pinned
    ? { min: 0, max: pinnedCount - 1 }
    : { min: pinnedCount, max: tabs.length - 1 };
}

function clampMoveIndex(tabs, tab, delta) {
  const { min, max } = moveBounds(tabs, tab);
  return Math.min(max, Math.max(min, tab.index + delta));
}

// Nearest grouped tab by distance; the left one wins a tie.
function findNearestGroupId(tabs, index) {
  for (let left = index - 1, right = index + 1; left >= 0 || right < tabs.length; left--, right++) {
    if (left >= 0 && tabs[left].groupId !== NO_GROUP) return tabs[left].groupId;
    if (right < tabs.length && tabs[right].groupId !== NO_GROUP) return tabs[right].groupId;
  }
  return NO_GROUP;
}

function filterByPattern(tabs, pattern) {
  const re = new RegExp(pattern, "i");
  return tabs.filter((t) => !t.pinned && (re.test(t.url || "") || re.test(t.title || "")));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function windowTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.sort((a, b) => a.index - b.index);
}

async function resolveTab(sender) {
  if (sender && sender.tab) return sender.tab;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function handleMessage(msg, sender) {
  const tab = await resolveTab(sender);
  if (!tab) return { ok: false, notice: "No active tab" };
  const tabs = await windowTabs(tab.windowId);

  switch (msg.type) {
    case "move":
      await chrome.tabs.move(tab.id, { index: clampMoveIndex(tabs, tab, msg.delta) });
      return { ok: true };

    case "moveEdge": {
      const { min, max } = moveBounds(tabs, tab);
      await chrome.tabs.move(tab.id, { index: msg.edge === "start" ? min : max });
      return { ok: true };
    }

    case "createGroup": {
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      const title = groupTitleFor(tab.url);
      await chrome.tabGroups.update(groupId, { title, color: groupColorFor(title) });
      return { ok: true, notice: `Grouped: ${title}` };
    }

    case "joinGroup": {
      const groupId = findNearestGroupId(tabs, tab.index);
      if (groupId === NO_GROUP) return { ok: false, notice: "No group nearby" };
      await chrome.tabs.group({ tabIds: [tab.id], groupId });
      const group = await chrome.tabGroups.get(groupId);
      return { ok: true, notice: `Joined: ${group.title || "group"}` };
    }

    case "ungroup":
      if (tab.groupId === NO_GROUP) return { ok: false, notice: "Not in a group" };
      await chrome.tabs.ungroup(tab.id);
      return { ok: true };

    case "dissolveGroup": {
      if (tab.groupId === NO_GROUP) return { ok: false, notice: "Not in a group" };
      const members = tabs.filter((t) => t.groupId === tab.groupId);
      await chrome.tabs.ungroup(members.map((t) => t.id));
      return { ok: true, notice: `Ungrouped ${plural(members.length, "tab")}` };
    }

    case "countMatches":
      try {
        return { ok: true, count: filterByPattern(tabs, msg.pattern).length };
      } catch {
        return { ok: false, notice: "Invalid regex" };
      }

    case "closeMatches": {
      let matches;
      try {
        matches = filterByPattern(tabs, msg.pattern);
      } catch {
        return { ok: false, notice: "Invalid regex" };
      }
      if (matches.length === 0) return { ok: true, count: 0, notice: "No matches" };
      await chrome.tabs.remove(matches.map((t) => t.id));
      return { ok: true, count: matches.length, notice: `Closed ${plural(matches.length, "tab")}` };
    }

    default:
      return { ok: false, notice: `Unknown message: ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, notice: `Tabz: ${err.message || err}` }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  const msg = COMMAND_MESSAGES[command];
  if (msg) return handleMessage(msg, null).catch(() => {});
});
