import { expect, test, vi } from "vitest";
import {
    createChromeMock,
    defaultConfig,
    fetchMock,
    windowOrder,
    tabById,
    type MockGroup,
    type MockReadingListEntry,
    type MockTab,
    type MockTabInit,
} from "./chrome-mock";

interface BackgroundExports {
    handleMessage: <K extends TabzMessageType>(
        msg: { type: K } & TabzMessageMap[K],
        sender?: { tab?: MockTab },
    ) => Promise<TabzResponseFor<K>>;
    groupTitleFor: (url: string) => string;
    groupColorFor: (title: string) => string;
    GROUP_COLORS: readonly string[];
}

// The worker is an ES module, so unlike the content script it is imported
// for real: the chrome/fetch globals are stubbed first, and the module
// registry is reset so each test evaluates a fresh instance bound to its own
// mock.
async function setup(
    tabs: MockTabInit[],
    groups?: Record<number, MockGroup>,
    stored?: Record<string, unknown>,
    readingList?: MockReadingListEntry[],
) {
    const { chrome, state } = createChromeMock({
        tabs,
        groups,
        stored,
        readingList,
    });
    vi.stubGlobal("chrome", chrome);
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    // @ts-expect-error: dist/ is compiled output with no declaration files
    const module = await import("../dist/background.js");
    const exports = module as BackgroundExports;
    return {
        state,
        exports,
        handle: exports.handleMessage,
        sender: (id: number) => ({ tab: tabById(state, id) }),
    };
}

test("move shifts the tab by delta", async () => {
    const { state, handle, sender } = await setup([
        { id: 1 },
        { id: 2 },
        { id: 3 },
    ]);
    const res = await handle({ type: "move", delta: 1 }, sender(2));
    expect(res.ok).toBe(true);
    expect(windowOrder(state, 1)).toEqual([1, 3, 2]);
});

test("move clamps at the right edge", async () => {
    const { state, handle, sender } = await setup([
        { id: 1 },
        { id: 2 },
        { id: 3 },
    ]);
    await handle({ type: "move", delta: 99 }, sender(1));
    expect(windowOrder(state, 1)).toEqual([2, 3, 1]);
});

test("move clamps at the left edge", async () => {
    const { state, handle, sender } = await setup([
        { id: 1 },
        { id: 2 },
        { id: 3 },
    ]);
    await handle({ type: "move", delta: -5 }, sender(1));
    expect(windowOrder(state, 1)).toEqual([1, 2, 3]);
});

test("unpinned tab cannot move into the pinned region", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, pinned: true },
        { id: 2, pinned: true },
        { id: 3 },
        { id: 4 },
    ]);
    await handle({ type: "move", delta: -9 }, sender(3));
    expect(windowOrder(state, 1)).toEqual([1, 2, 3, 4]);
});

test("pinned tab stays inside the pinned region", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, pinned: true },
        { id: 2, pinned: true },
        { id: 3 },
        { id: 4 },
    ]);
    await handle({ type: "move", delta: 9 }, sender(1));
    expect(windowOrder(state, 1)).toEqual([2, 1, 3, 4]);
});

test("moveEdge start lands just after the pinned region", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, pinned: true },
        { id: 2, pinned: true },
        { id: 3 },
        { id: 4 },
    ]);
    await handle({ type: "moveEdge", edge: "start" }, sender(4));
    expect(windowOrder(state, 1)).toEqual([1, 2, 4, 3]);
});

test("moveEdge end moves to the last position", async () => {
    const { state, handle, sender } = await setup([
        { id: 1 },
        { id: 2 },
        { id: 3 },
    ]);
    await handle({ type: "moveEdge", edge: "end" }, sender(1));
    expect(windowOrder(state, 1)).toEqual([2, 3, 1]);
});

test("createGroup auto-names from the hostname and picks a palette color", async () => {
    const { state, handle, sender, exports } = await setup([
        { id: 1, url: "https://www.github.com/foo" },
    ]);
    const res = await handle({ type: "createGroup" }, sender(1));
    expect(res.ok).toBe(true);
    expect(res.notice).toBe("Grouped: github.com");
    expect(tabById(state, 1).groupId).toBe(100);
    expect(state.groups[100].title).toBe("github.com");
    expect(exports.GROUP_COLORS).toContain(state.groups[100].color);
});

test("groupColorFor is deterministic", async () => {
    const { exports } = await setup([]);
    expect(exports.groupColorFor("github.com")).toBe(
        exports.groupColorFor("github.com"),
    );
});

test("groupTitleFor falls back and strips www", async () => {
    const { exports } = await setup([]);
    expect(exports.groupTitleFor("https://www.github.com/x")).toBe(
        "github.com",
    );
    expect(exports.groupTitleFor("chrome://settings/")).toBe("settings");
    expect(exports.groupTitleFor("not a url")).toBe("tabs");
});

test("joinGroup prefers the left group on a distance tie", async () => {
    const { state, handle, sender } = await setup(
        [{ id: 1, groupId: 5 }, { id: 2 }, { id: 3, groupId: 7 }],
        { 5: { title: "left" }, 7: { title: "right" } },
    );
    const res = await handle({ type: "joinGroup" }, sender(2));
    expect(res.notice).toBe("Joined: left");
    expect(tabById(state, 2).groupId).toBe(5);
});

test("joinGroup falls back to the nearest group on the right", async () => {
    const { state, handle, sender } = await setup(
        [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, groupId: 7 }],
        { 7: { title: "right" } },
    );
    const res = await handle({ type: "joinGroup" }, sender(2));
    expect(res.notice).toBe("Joined: right");
    expect(tabById(state, 2).groupId).toBe(7);
});

test("joinGroup reports when no group exists", async () => {
    const { handle, sender } = await setup([{ id: 1 }, { id: 2 }]);
    const res = await handle({ type: "joinGroup" }, sender(1));
    expect(res).toEqual({ ok: false, notice: "No group nearby" });
});

test("ungroup removes only the current tab", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, groupId: 5 },
        { id: 2, groupId: 5 },
    ]);
    const res = await handle({ type: "ungroup" }, sender(1));
    expect(res.ok).toBe(true);
    expect(tabById(state, 1).groupId).toBe(-1);
    expect(tabById(state, 2).groupId).toBe(5);
});

test("ungroup reports when the tab is not grouped", async () => {
    const { handle, sender } = await setup([{ id: 1 }]);
    const res = await handle({ type: "ungroup" }, sender(1));
    expect(res).toEqual({ ok: false, notice: "Not in a group" });
});

test("dissolveGroup ungroups every member and nothing else", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, groupId: 5 },
        { id: 2, groupId: 5 },
        { id: 3, groupId: 9 },
    ]);
    const res = await handle({ type: "dissolveGroup" }, sender(1));
    expect(res.notice).toBe("Ungrouped 2 tabs");
    expect(tabById(state, 1).groupId).toBe(-1);
    expect(tabById(state, 2).groupId).toBe(-1);
    expect(tabById(state, 3).groupId).toBe(9);
});

const READING_TAB: MockTabInit = {
    id: 1,
    url: "https://example.com/article",
    title: "Article",
};

const READING_ENTRY: MockReadingListEntry = {
    url: "https://example.com/article",
    title: "Article",
    hasBeenRead: false,
};

test("readingListAdd saves the tab's url and title, unread", async () => {
    const { state, handle, sender } = await setup([READING_TAB]);
    const res = await handle({ type: "readingListAdd" }, sender(1));
    expect(res).toEqual({ ok: true, notice: "Added to reading list" });
    expect(state.readingList).toEqual([READING_ENTRY]);
});

test("readingListAdd falls back to the url when the title is empty", async () => {
    const { state, handle, sender } = await setup([
        { ...READING_TAB, title: "" },
    ]);
    await handle({ type: "readingListAdd" }, sender(1));
    expect(state.readingList[0].title).toBe("https://example.com/article");
});

test("readingListAdd is a no-op when the url is already listed", async () => {
    const { state, handle, sender } = await setup(
        [READING_TAB],
        undefined,
        undefined,
        [{ ...READING_ENTRY, title: "Saved earlier", hasBeenRead: true }],
    );
    const res = await handle({ type: "readingListAdd" }, sender(1));
    expect(res).toEqual({ ok: true, notice: "Already in reading list" });
    expect(state.readingList).toEqual([
        { ...READING_ENTRY, title: "Saved earlier", hasBeenRead: true },
    ]);
});

test("readingListAdd rejects non-http(s) pages", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, url: "file:///home/me/notes.html" },
    ]);
    const res = await handle({ type: "readingListAdd" }, sender(1));
    expect(res).toEqual({
        ok: false,
        notice: "Reading list only accepts http(s) pages",
    });
    expect(state.readingList).toEqual([]);
});

test("readingListRemove deletes only the matching entry", async () => {
    const other = {
        url: "https://other.com/",
        title: "Other",
        hasBeenRead: false,
    };
    const { state, handle, sender } = await setup(
        [READING_TAB],
        undefined,
        undefined,
        [READING_ENTRY, other],
    );
    const res = await handle({ type: "readingListRemove" }, sender(1));
    expect(res).toEqual({ ok: true, notice: "Removed from reading list" });
    expect(state.readingList).toEqual([other]);
});

test("readingListRemove is a no-op when the url is not listed", async () => {
    const { handle, sender } = await setup([READING_TAB]);
    const res = await handle({ type: "readingListRemove" }, sender(1));
    expect(res).toEqual({ ok: true, notice: "Not in reading list" });
});

test("keyboard command adds the active tab to the reading list", async () => {
    const { state } = await setup([{ ...READING_TAB, active: true }]);
    await state.listeners.command!("reading-list-add");
    expect(state.readingList).toEqual([READING_ENTRY]);
});

const REGEX_FIXTURE: MockTabInit[] = [
    { id: 1, url: "https://news.ycombinator.com", title: "HN" },
    { id: 2, url: "https://example.com", title: "Docs about NEWS" },
    {
        id: 3,
        url: "https://news.example.com",
        title: "pinned news",
        pinned: true,
    },
    {
        id: 4,
        url: "https://news.other.com",
        title: "other window",
        windowId: 2,
    },
];

test("countMatches checks url and title, skips pinned and other windows", async () => {
    const { handle, sender } = await setup(REGEX_FIXTURE);
    const res = await handle(
        { type: "countMatches", pattern: "news" },
        sender(1),
    );
    expect(res).toEqual({ ok: true, count: 2 });
});

test("countMatches rejects an invalid regex", async () => {
    const { handle, sender } = await setup(REGEX_FIXTURE);
    const res = await handle({ type: "countMatches", pattern: "[" }, sender(1));
    expect(res).toEqual({ ok: false, notice: "Invalid regex" });
});

test("closeMatches removes exactly the matching tabs", async () => {
    const { state, handle, sender } = await setup(REGEX_FIXTURE);
    const res = await handle(
        { type: "closeMatches", pattern: "news" },
        sender(1),
    );
    expect(res.notice).toBe("Closed 2 tabs");
    expect(state.removed.sort()).toEqual([1, 2]);
    expect(windowOrder(state, 1)).toEqual([3]);
    expect(windowOrder(state, 2)).toEqual([4]);
});

test("closeMatches with no matches removes nothing", async () => {
    const { state, handle, sender } = await setup(REGEX_FIXTURE);
    const res = await handle(
        { type: "closeMatches", pattern: "zzzzz" },
        sender(1),
    );
    expect(res).toEqual({ ok: true, count: 0, notice: "No matches" });
    expect(state.removed).toEqual([]);
});

test("closeDups removes duplicate tabs, keeping the first of each url", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, url: "https://example.com" },
        { id: 2, url: "https://other.com" },
        { id: 3, url: "https://example.com" },
        { id: 4, url: "https://example.com" },
        { id: 5, url: "https://other.com" },
    ]);
    const res = await handle({ type: "closeDups" }, sender(1));
    expect(res.ok).toBe(true);
    expect(res.notice).toBe("Closed 3 duplicates");
    expect(state.removed.sort()).toEqual([3, 4, 5]);
    expect(windowOrder(state, 1)).toEqual([1, 2]);
});

test("closeDups with no duplicates removes nothing", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, url: "https://a.com" },
        { id: 2, url: "https://b.com" },
        { id: 3, url: "https://c.com" },
    ]);
    const res = await handle({ type: "closeDups" }, sender(1));
    expect(res).toEqual({ ok: true, count: 0, notice: "No duplicates" });
    expect(state.removed).toEqual([]);
});

test("closeDups scopes to the sender's window", async () => {
    const { state, handle, sender } = await setup([
        { id: 1, url: "https://example.com", windowId: 1 },
        { id: 2, url: "https://example.com", windowId: 2 },
    ]);
    const res = await handle({ type: "closeDups" }, sender(1));
    expect(res).toEqual({ ok: true, count: 0, notice: "No duplicates" });
    expect(state.removed).toEqual([]);
});

test("closeDups singular notice for a single duplicate", async () => {
    const { handle, sender } = await setup([
        { id: 1, url: "https://a.com" },
        { id: 2, url: "https://a.com" },
    ]);
    const res = await handle({ type: "closeDups" }, sender(1));
    expect(res.notice).toBe("Closed 1 duplicate");
});

test("onMessage listener responds asynchronously and returns true", async () => {
    const { state } = await setup([{ id: 1 }]);
    const res = await new Promise<TabzResponse>((resolve) => {
        const returned = state.listeners.message!(
            { type: "ungroup" },
            { tab: tabById(state, 1) },
            resolve,
        );
        expect(returned).toBe(true);
    });
    expect(res).toEqual({ ok: false, notice: "Not in a group" });
});

test("keyboard command acts on the active tab", async () => {
    const { state } = await setup([
        { id: 1, active: true },
        { id: 2 },
        { id: 3 },
    ]);
    await state.listeners.command!("move-right");
    expect(windowOrder(state, 1)).toEqual([2, 1, 3]);
});

function payloadOf(res: TabzResponseFor<"getConfig">): TabzConfigPayload {
    if (!res.ok) throw new Error("Expected a config payload");
    return res.config;
}

test("getConfig returns the config.json defaults when storage is empty", async () => {
    const { handle } = await setup([]);
    const payload = payloadOf(await handle({ type: "getConfig" }));
    expect(payload.defaults).toEqual(defaultConfig());
    expect(payload.current).toEqual(payload.defaults);
    expect(payload.warnings).toEqual([]);
});

test("getConfig overlays a partial stored config onto the defaults", async () => {
    const { handle } = await setup([], undefined, {
        config: { keys: { moveLeft: "h" } },
    });
    const { current } = payloadOf(await handle({ type: "getConfig" }));
    expect(current.leader).toBe("s");
    expect(current.keys.moveLeft).toBe("h");
    expect(current.keys.moveRight).toBe("e");
});

test("getConfig falls back to defaults when bindings collide, with a warning", async () => {
    const stored = defaultConfig();
    stored.keys.moveLeft = "e";
    const { handle } = await setup([], undefined, { config: stored });
    const { current, warnings } = payloadOf(
        await handle({ type: "getConfig" }),
    );
    expect(current).toEqual(defaultConfig());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/bound to "e"/);
});

test("getConfig honors a stored two-character override", async () => {
    const { handle } = await setup([], undefined, {
        config: { keys: { moveLeft: "gw" } },
    });
    const { current } = payloadOf(await handle({ type: "getConfig" }));
    expect(current.keys.moveLeft).toBe("gw");
});

test("getConfig falls back to defaults when a stored binding prefixes another", async () => {
    const { handle } = await setup([], undefined, {
        config: { keys: { moveLeft: "ec" } },
    });
    const { current, warnings } = payloadOf(
        await handle({ type: "getConfig" }),
    );
    expect(current).toEqual(defaultConfig());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/prefix/);
});

test("getConfig keeps valid overrides and warns about invalid ones", async () => {
    const { handle } = await setup([], undefined, {
        config: {
            leader: "<script>alert(1)</script>",
            keys: {
                moveLeft: "h",
                moveRight: "<img src=x onerror=alert(1)>",
            },
        },
    });
    const { current, warnings } = payloadOf(
        await handle({ type: "getConfig" }),
    );
    expect(current.leader).toBe("s");
    expect(current.keys.moveLeft).toBe("h");
    expect(current.keys.moveRight).toBe("e");
    expect(warnings).toHaveLength(2);
});

test("getConfig warns and uses defaults when the stored config is not an object", async () => {
    const { handle } = await setup([], undefined, { config: "<script>" });
    const payload = payloadOf(await handle({ type: "getConfig" }));
    expect(payload.current).toEqual(defaultConfig());
    expect(payload.warnings).toHaveLength(1);
});

test("getConfig warns about unknown actions without dropping valid ones", async () => {
    const { handle } = await setup([], undefined, {
        config: { keys: { moveLeft: "h", evalArbitraryCode: "z" } },
    });
    const { current, warnings } = payloadOf(
        await handle({ type: "getConfig" }),
    );
    expect(current.keys.moveLeft).toBe("h");
    expect(warnings).toEqual(['Unknown action "evalArbitraryCode"']);
});

test("setConfig persists a valid config and getConfig reflects it", async () => {
    const { state, handle } = await setup([]);
    const config = defaultConfig();
    config.leader = ",";
    config.keys.regexClose = ";";
    const res = await handle({ type: "setConfig", config });
    expect(res).toEqual({ ok: true, notice: "Saved" });
    expect(state.stored["config"]).toEqual(config);
    const { current } = payloadOf(await handle({ type: "getConfig" }));
    expect(current).toEqual(config);
});

test("setConfig rejects a key outside the allowed set", async () => {
    const { state, handle } = await setup([]);
    for (const bad of ["1", "www", "w1", "", "!"]) {
        const config = defaultConfig();
        config.keys.moveLeft = bad;
        const res = await handle({ type: "setConfig", config });
        expect(res.ok).toBe(false);
    }
    expect(state.stored).toEqual({});
});

test("setConfig persists two-character bindings", async () => {
    const { state, handle } = await setup([]);
    const config = defaultConfig();
    config.keys.createGroup = "cg";
    const res = await handle({ type: "setConfig", config });
    expect(res.ok).toBe(true);
    expect(state.stored["config"]).toEqual(config);
});

test("setConfig rejects a binding that prefixes another", async () => {
    const { handle } = await setup([]);
    const config = defaultConfig();
    config.keys.createGroup = "wc";
    const res = await handle({ type: "setConfig", config });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.notice).toMatch(/prefix/);
});

test("setConfig rejects duplicate bindings", async () => {
    const { handle } = await setup([]);
    const config = defaultConfig();
    config.keys.moveLeft = "e";
    const res = await handle({ type: "setConfig", config });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.notice).toMatch(/moveLeft and moveRight/);
});

test("setConfig allows a binding equal to the leader, vim ss-style", async () => {
    const { handle } = await setup([]);
    const res = await handle({ type: "setConfig", config: defaultConfig() });
    expect(res.ok).toBe(true);
});

test("setConfig rejects a digit leader", async () => {
    const { handle } = await setup([]);
    const config = defaultConfig();
    config.leader = "0";
    const res = await handle({ type: "setConfig", config });
    expect(res.ok).toBe(false);
});

test("setConfig rejects an unknown action", async () => {
    const { handle } = await setup([]);
    const config = defaultConfig() as TabzConfig & {
        keys: Record<string, string>;
    };
    config.keys["closeAll"] = "z";
    const res = await handle({ type: "setConfig", config });
    expect(res).toEqual({ ok: false, notice: 'Unknown action "closeAll"' });
});

test("validateConfig reports errors without persisting anything", async () => {
    const { state, handle } = await setup([]);
    const config = defaultConfig();
    config.keys.ungroup = "3";
    expect((await handle({ type: "validateConfig", config })).ok).toBe(false);
    expect(
        (await handle({ type: "validateConfig", config: defaultConfig() })).ok,
    ).toBe(true);
    expect(state.stored).toEqual({});
});
