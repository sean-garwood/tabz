import { expect, test, beforeEach } from "vitest";
import { defaultConfig, loadScript } from "./chrome-mock";

interface ParseResult {
    handled: boolean;
    command?: TabzCommand;
}

interface ContentExports {
    createSequenceParser: (
        config: TabzConfig,
        now?: () => number,
    ) => {
        feed: (key: string) => ParseResult;
        reset: () => void;
    };
    isEditableTarget: (event: unknown) => boolean;
}

// No chrome in the sandbox, so the script's install() guard keeps it from
// wiring up any DOM listeners.
const { createSequenceParser, isEditableTarget } = loadScript<ContentExports>(
    "dist/content.js",
    {},
    ["createSequenceParser", "isEditableTarget"],
);

function makeParser(config = defaultConfig()) {
    let t = 1000;
    const parser = createSequenceParser(config, () => t);
    return { parser, tick: (ms: number) => (t += ms) };
}

function feedAll(
    parser: ReturnType<typeof createSequenceParser>,
    keys: string[],
) {
    return keys.map((k) => parser.feed(k));
}

let parser: ReturnType<typeof createSequenceParser>;
let tick: (ms: number) => number;
beforeEach(() => {
    ({ parser, tick } = makeParser());
});

test("sw moves left by one", () => {
    const results = feedAll(parser, ["s", "w"]);
    expect(results[0]).toEqual({ handled: true });
    expect(results[1]).toEqual({
        handled: true,
        command: { type: "move", delta: -1 },
    });
});

test("count before the leader: 3se moves right by three", () => {
    const results = feedAll(parser, ["3", "s", "e"]);
    expect(results[0].handled).toBe(false);
    expect(results[2].command).toEqual({ type: "move", delta: 3 });
});

test("count after the leader: s3e moves right by three", () => {
    const results = feedAll(parser, ["s", "3", "e"]);
    expect(results[1].handled).toBe(true);
    expect(results[2].command).toEqual({ type: "move", delta: 3 });
});

test("zero extends a count in progress: 2s0w moves left by twenty", () => {
    const results = feedAll(parser, ["2", "s", "0", "w"]);
    expect(results[3].command).toEqual({ type: "move", delta: -20 });
});

test("20sw moves left by twenty", () => {
    const results = feedAll(parser, ["2", "0", "s", "w"]);
    expect(results[3].command).toEqual({ type: "move", delta: -20 });
});

test("bare s0 moves to the start and s$ to the end", () => {
    expect(feedAll(parser, ["s", "0"])[1].command).toEqual({
        type: "moveEdge",
        edge: "start",
    });
    expect(feedAll(parser, ["s", "$"])[1].command).toEqual({
        type: "moveEdge",
        edge: "end",
    });
});

test("counts are capped", () => {
    const results = feedAll(parser, ["1", "2", "3", "s", "w"]);
    expect(results[4].command).toEqual({ type: "move", delta: -99 });
});

test("group and prompt sequences", () => {
    expect(feedAll(parser, ["s", "c"])[1].command).toEqual({
        type: "createGroup",
    });
    expect(feedAll(parser, ["s", "a"])[1].command).toEqual({
        type: "joinGroup",
    });
    expect(feedAll(parser, ["s", "q"])[1].command).toEqual({ type: "ungroup" });
    expect(feedAll(parser, ["s", "Q"])[1].command).toEqual({
        type: "dissolveGroup",
    });
    expect(feedAll(parser, ["s", "s"])[1].command).toEqual({ type: "prompt" });
});

test("an unknown continuation cancels and passes the key through", () => {
    const results = feedAll(parser, ["s", "x", "w"]);
    expect(results[1]).toEqual({ handled: false });
    expect(results[2]).toEqual({ handled: false });
});

test("a pending sequence times out", () => {
    parser.feed("s");
    tick(3000);
    expect(parser.feed("w")).toEqual({ handled: false });
});

test("Escape cancels a pending sequence and is suppressed", () => {
    parser.feed("s");
    expect(parser.feed("Escape")).toEqual({ handled: true });
    expect(parser.feed("w")).toEqual({ handled: false });
});

test("Escape while idle clears a pending count and passes through", () => {
    parser.feed("3");
    expect(parser.feed("Escape")).toEqual({ handled: false });
    const results = feedAll(parser, ["s", "e"]);
    expect(results[1].command).toEqual({ type: "move", delta: 1 });
});

test("a custom leader and rebound key drive the sequence map", () => {
    const config = defaultConfig();
    config.leader = ",";
    config.keys.moveLeft = "h";
    const custom = makeParser(config).parser;
    expect(feedAll(custom, [",", "h"])[1].command).toEqual({
        type: "move",
        delta: -1,
    });
    expect(feedAll(custom, ["s", "w"]).some((r) => r.handled)).toBe(false);
});

test("the old key is freed when an action is rebound", () => {
    const config = defaultConfig();
    config.keys.moveStart = "g";
    const custom = makeParser(config).parser;
    expect(feedAll(custom, ["s", "g"])[1].command).toEqual({
        type: "moveEdge",
        edge: "start",
    });
    expect(feedAll(custom, ["s", "0"])[1]).toEqual({ handled: false });
});

test("counts still work under a rebound leader", () => {
    const config = defaultConfig();
    config.leader = ".";
    const custom = makeParser(config).parser;
    expect(feedAll(custom, [".", "3", "e"])[2].command).toEqual({
        type: "move",
        delta: 3,
    });
});

test("a missing binding is ignored rather than matched", () => {
    const config = defaultConfig();
    config.keys.createGroup = "";
    const custom = makeParser(config).parser;
    expect(feedAll(custom, ["s", "c"])[1]).toEqual({ handled: false });
});

test("markup smuggled into a binding never matches a keystroke", () => {
    // The worker's schema rejects multi-character values before they reach the
    // content script; even unsanitized, they map to no real event.key and are
    // never interpreted as HTML.
    const config = defaultConfig();
    config.keys.moveLeft = "<script>alert(1)</script>";
    const custom = makeParser(config).parser;
    expect(feedAll(custom, ["s", "w"])[1]).toEqual({ handled: false });
    expect(feedAll(custom, ["s", "<"])[1]).toEqual({ handled: false });
});

test("isEditableTarget recognizes inputs and contenteditable", () => {
    const evt = (el: object) => ({ composedPath: () => [el], target: el });
    expect(isEditableTarget(evt({ nodeType: 1, tagName: "INPUT" }))).toBe(true);
    expect(isEditableTarget(evt({ nodeType: 1, tagName: "TEXTAREA" }))).toBe(
        true,
    );
    expect(
        isEditableTarget(
            evt({ nodeType: 1, tagName: "DIV", isContentEditable: true }),
        ),
    ).toBe(true);
    expect(isEditableTarget(evt({ nodeType: 1, tagName: "DIV" }))).toBe(false);
    expect(
        isEditableTarget({ target: { nodeType: 1, tagName: "INPUT" } }),
    ).toBe(true);
    expect(isEditableTarget({ target: null })).toBe(false);
});
