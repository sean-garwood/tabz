const NO_GROUP = -1;

// Schema for TabzConfig fields; both parseConfig (lenient, for stored data)
// and validateConfig (strict, for options-page submissions) enforce it.
// Digits 1-9 are reserved for count prefixes, and "0" would shadow a count in
// progress as the leader, so neither is leader-bindable.
interface FieldRule {
    pattern: RegExp;
    expected: string;
}

const CONFIG_SCHEMA: { leader: FieldRule; key: FieldRule } = {
    leader: {
        pattern: /^[a-zA-Z,.;]$/,
        expected: "a single letter or one of , . ;",
    },
    key: {
        pattern: /^[a-zA-Z0$,.;]$/,
        expected: "a single letter or one of 0 $ , . ;",
    },
};

function fieldError(rule: FieldRule, name: string, value: unknown) {
    return typeof value === "string" && rule.pattern.test(value)
        ? null
        : `${name} must be ${rule.expected}`;
}

function duplicateBinding(keys: Record<TabzAction, string>): string | null {
    const bound = new Map<string, string>();
    for (const [action, key] of Object.entries(keys)) {
        const taken = bound.get(key);
        if (taken) return `${taken} and ${action} are both bound to "${key}"`;
        bound.set(key, action);
    }
    return null;
}

interface ParsedConfig {
    config: TabzConfig;
    warnings: string[];
}

// Checks untrusted stored data against the schema. Valid fields overlay the
// shipped defaults; anything invalid or unknown keeps its default and is
// reported as a warning so the user learns their override was rejected.
function parseConfig(defaults: TabzConfig, stored: unknown): ParsedConfig {
    const config: TabzConfig = {
        leader: defaults.leader,
        keys: { ...defaults.keys },
    };
    const warnings: string[] = [];
    if (stored === undefined) return { config, warnings };
    if (typeof stored !== "object" || stored === null)
        return { config, warnings: ["Stored config is not an object"] };

    const { leader, keys } = stored as Record<keyof TabzConfig, unknown>;
    if (leader !== undefined) {
        const err = fieldError(CONFIG_SCHEMA.leader, "leader", leader);
        if (err) warnings.push(err);
        else config.leader = leader as string;
    }
    if (keys !== undefined) {
        if (typeof keys !== "object" || keys === null)
            warnings.push("keys must be an object");
        else
            for (const [action, key] of Object.entries(keys)) {
                if (!(action in defaults.keys)) {
                    warnings.push(`Unknown action "${action}"`);
                    continue;
                }
                const err = fieldError(CONFIG_SCHEMA.key, action, key);
                if (err) warnings.push(err);
                else config.keys[action as TabzAction] = key as string;
            }
    }

    // Individually valid overrides can still collide with each other or with
    // an untouched default; the merged result must stay conflict-free.
    const conflict = duplicateBinding(config.keys);
    if (conflict)
        return {
            config: { leader: defaults.leader, keys: { ...defaults.keys } },
            warnings: [...warnings, `${conflict}; using default bindings`],
        };
    return { config, warnings };
}

// Strict whole-config check for validateConfig/setConfig messages: every
// field must satisfy the schema, nothing is silently dropped.
function validateConfig(config: unknown, defaults: TabzConfig): string | null {
    if (typeof config !== "object" || config === null)
        return "Config must be an object";
    const { leader, keys } = config as Record<keyof TabzConfig, unknown>;
    const leaderErr = fieldError(CONFIG_SCHEMA.leader, "Leader", leader);
    if (leaderErr) return leaderErr;
    if (typeof keys !== "object" || keys === null)
        return "Config is missing its key map";
    for (const action of Object.keys(keys))
        if (!(action in defaults.keys)) return `Unknown action "${action}"`;
    for (const action of Object.keys(defaults.keys)) {
        const err = fieldError(
            CONFIG_SCHEMA.key,
            action,
            (keys as Record<string, unknown>)[action],
        );
        if (err) return err;
    }
    return duplicateBinding(keys as Record<TabzAction, string>);
}

let defaultsPromise: Promise<TabzConfig> | undefined;

function configDefaults(): Promise<TabzConfig> {
    defaultsPromise ??= fetch(chrome.runtime.getURL("config.json")).then(
        (res) => res.json() as Promise<TabzConfig>,
    );
    return defaultsPromise;
}

async function effectiveConfig(defaults: TabzConfig): Promise<ParsedConfig> {
    const stored = await chrome.storage.sync.get("config");
    return parseConfig(defaults, stored["config"]);
}

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
