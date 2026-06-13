import { configDefaults, effectiveConfig, validateConfig } from "./config.js";

const NO_GROUP = -1;

type GroupColor = `${chrome.tabGroups.Color}`;

const GROUP_COLORS = [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
] as const satisfies readonly GroupColor[];

const COMMAND_MESSAGES = {
    "move-left": { type: "move", delta: -1 },
    "move-right": { type: "move", delta: 1 },
    "create-group": { type: "createGroup" },
    ungroup: { type: "ungroup" },
    "reading-list-add": { type: "readingListAdd" },
    "reading-list-remove": { type: "readingListRemove" },
} as const satisfies Record<string, TabzMessage>;

type CommandName = keyof typeof COMMAND_MESSAGES;

function isCommandName(cmd: string): cmd is CommandName {
    return cmd in COMMAND_MESSAGES;
}

function groupTitleFor(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        return host || "tabs";
    } catch {
        return "tabs";
    }
}

function groupColorFor(title: string): GroupColor {
    let hash = 0;
    for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
    return GROUP_COLORS[hash % GROUP_COLORS.length];
}

function moveBounds(
    tabs: ResolvedTab[],
    tab: ResolvedTab,
): { min: number; max: number } {
    const pinnedCount = tabs.filter((t) => t.pinned).length;
    return tab.pinned
        ? { min: 0, max: pinnedCount - 1 }
        : { min: pinnedCount, max: tabs.length - 1 };
}

function clampMoveIndex(
    tabs: ResolvedTab[],
    tab: ResolvedTab,
    delta: number,
): number {
    const { min, max } = moveBounds(tabs, tab);
    return Math.min(max, Math.max(min, tab.index + delta));
}

function findNearestGroupId(tabs: ResolvedTab[], index: number): number {
    const grouped = tabs.filter((t) => t.groupId !== NO_GROUP);
    if (!grouped.length) return NO_GROUP;
    let best = grouped[0];
    for (const t of grouped) {
        if (Math.abs(t.index - index) < Math.abs(best.index - index)) best = t;
    }
    return best.groupId;
}

function filterByPattern(tabs: ResolvedTab[], pattern: string): ResolvedTab[] {
    const re = new RegExp(pattern, "i");
    return tabs.filter(
        (t) => !t.pinned && (re.test(t.url || "") || re.test(t.title || "")),
    );
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The reading list accepts only http(s) URLs; Chrome rejects anything else
// (chrome://, file://, about:) with a thrown error.
function isReadingListUrl(url: string | undefined): url is string {
    return url !== undefined && /^https?:\/\//.test(url);
}

function isResolvedTab(tab: chrome.tabs.Tab): tab is ResolvedTab {
    return tab.id !== undefined;
}

async function windowTabs(windowId: number): Promise<ResolvedTab[]> {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.filter(isResolvedTab).sort((a, b) => a.index - b.index);
}

async function resolveTab(
    sender?: chrome.runtime.MessageSender,
): Promise<ResolvedTab | undefined> {
    const tab =
        sender?.tab ??
        (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    return tab && isResolvedTab(tab) ? tab : undefined;
}

async function handleMessage(
    msg: TabzMessage,
    sender?: chrome.runtime.MessageSender,
): Promise<TabzResponse> {
    switch (msg.type) {
        case "getConfig": {
            const defaults = await configDefaults();
            const { config, warnings } = await effectiveConfig(defaults);
            return {
                ok: true,
                config: { current: config, defaults, warnings },
            };
        }

        case "validateConfig":
        case "setConfig": {
            const err = validateConfig(msg.config, await configDefaults());
            if (err) return { ok: false, notice: err };
            if (msg.type === "validateConfig") return { ok: true };
            await chrome.storage.sync.set({ config: msg.config });
            return { ok: true, notice: "Saved" };
        }
    }

    const tab = await resolveTab(sender);
    if (!tab) return { ok: false, notice: "No active tab" };
    const tabs = await windowTabs(tab.windowId);

    switch (msg.type) {
        case "move":
            await chrome.tabs.move(tab.id, {
                index: clampMoveIndex(tabs, tab, msg.delta),
            });
            return { ok: true };

        case "moveEdge": {
            const { min, max } = moveBounds(tabs, tab);
            await chrome.tabs.move(tab.id, {
                index: msg.edge === "start" ? min : max,
            });
            return { ok: true };
        }

        case "createGroup": {
            const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
            const title = groupTitleFor(tab.url ?? "");
            await chrome.tabGroups.update(groupId, {
                title,
                color: groupColorFor(title),
            });
            return { ok: true, notice: `Grouped: ${title}` };
        }

        case "joinGroup": {
            const groupId = findNearestGroupId(tabs, tab.index);
            if (groupId === NO_GROUP)
                return { ok: false, notice: "No group nearby" };
            await chrome.tabs.group({ tabIds: [tab.id], groupId });
            const group = await chrome.tabGroups.get(groupId);
            return { ok: true, notice: `Joined: ${group.title || "group"}` };
        }

        case "ungroup":
            if (tab.groupId === NO_GROUP)
                return { ok: false, notice: "Not in a group" };
            await chrome.tabs.ungroup(tab.id);
            return { ok: true };

        case "dissolveGroup": {
            if (tab.groupId === NO_GROUP)
                return { ok: false, notice: "Not in a group" };
            const members = tabs.filter((t) => t.groupId === tab.groupId);
            const ids = members.map((t) => t.id);
            await chrome.tabs.ungroup([ids[0], ...ids.slice(1)]);
            return {
                ok: true,
                notice: `Ungrouped ${plural(members.length, "tab")}`,
            };
        }

        case "readingListAdd": {
            if (!isReadingListUrl(tab.url))
                return {
                    ok: false,
                    notice: "Reading list only accepts http(s) pages",
                };
            const entries = await chrome.readingList.query({ url: tab.url });
            if (entries.length)
                return { ok: true, notice: "Already in reading list" };
            await chrome.readingList.addEntry({
                url: tab.url,
                title: tab.title || tab.url,
                hasBeenRead: false,
            });
            return { ok: true, notice: "Added to reading list" };
        }

        case "readingListRemove": {
            if (!isReadingListUrl(tab.url))
                return { ok: true, notice: "Not in reading list" };
            const entries = await chrome.readingList.query({ url: tab.url });
            if (!entries.length)
                return { ok: true, notice: "Not in reading list" };
            await chrome.readingList.removeEntry({ url: tab.url });
            return { ok: true, notice: "Removed from reading list" };
        }

        case "countMatches":
            try {
                return {
                    ok: true,
                    count: filterByPattern(tabs, msg.pattern).length,
                };
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
            if (matches.length === 0)
                return { ok: true, count: 0, notice: "No matches" };
            await chrome.tabs.remove(matches.map((t) => t.id));
            return {
                ok: true,
                count: matches.length,
                notice: `Closed ${plural(matches.length, "tab")}`,
            };
        }

        default:
            return { ok: false, notice: "Unknown message type" };
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender)
        .then(sendResponse)
        .catch((err) =>
            sendResponse({ ok: false, notice: `Tabz: ${err.message || err}` }),
        );
    return true;
});

chrome.commands.onCommand.addListener((command) => {
    if (isCommandName(command))
        return handleMessage(COMMAND_MESSAGES[command]).catch(() => {});
});

// Exported for the test suite only; nothing imports these at runtime.
export { handleMessage, groupTitleFor, groupColorFor, GROUP_COLORS };
