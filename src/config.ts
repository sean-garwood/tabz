// Key-binding config for the service worker: shipped defaults, the binding
// schema, and the lenient/strict checks built on it. Imported only by
// background.ts; the content script and options page reach this logic through
// getConfig / validateConfig / setConfig messages.

import { detectCapabilities } from "./capabilities.js";

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
        pattern: /^[a-zA-Z0$,.;]{1,2}$/,
        expected: "one or two characters from a-z A-Z 0 $ , . ;",
    },
};

function fieldError(rule: FieldRule, name: string, value: unknown) {
    return typeof value === "string" && rule.pattern.test(value)
        ? null
        : `${name} must be ${rule.expected}`;
}

// Sequences must be prefix-free: a binding that equals or starts another
// binding would make the shorter one fire before the longer one could ever
// complete, so the trie parser requires that neither case exists.
function sequenceConflict(keys: Record<TabzAction, string>): string | null {
    const bound = Object.entries(keys);
    for (let i = 0; i < bound.length; i++)
        for (let j = i + 1; j < bound.length; j++) {
            const [action, seq] = bound[i];
            const [other, otherSeq] = bound[j];
            if (seq === otherSeq)
                return `${action} and ${other} are both bound to "${seq}"`;
            if (seq.startsWith(otherSeq) || otherSeq.startsWith(seq))
                return (
                    `${action} ("${seq}") and ${other} ("${otherSeq}") ` +
                    "conflict: one is a prefix of the other"
                );
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
    // an untouched default; the merged result must stay prefix-free.
    const conflict = sequenceConflict(config.keys);
    if (conflict)
        return {
            config: { leader: defaults.leader, keys: { ...defaults.keys } },
            warnings: [...warnings, `${conflict}; using default bindings`],
        };
    return { config, warnings };
}

// Filters out browser-unsupported actions from a config based on
// runtime capabilities. Returns a new config with unavailable actions removed.
function filterConfigByCapabilities(
    config: TabzConfig,
    caps: ReturnType<typeof detectCapabilities>,
): TabzConfig {
    const filtered: Record<string, string> = {};

    for (const [action, key] of Object.entries(config.keys)) {
        // Only include actions that are available in this browser
        if (!caps.hasTabGroups) {
            if (
                action === "createGroup" ||
                action === "joinGroup" ||
                action === "ungroup" ||
                action === "dissolveGroup"
            )
                continue;
        }
        if (!caps.hasReadingList) {
            if (action === "readingListAdd" || action === "readingListRemove")
                continue;
        }
        filtered[action] = key;
    }

    return {
        leader: config.leader,
        keys: filtered as Record<TabzAction, string>,
    };
}

// Strict whole-config check for validateConfig/setConfig messages: every
// field must satisfy the schema, nothing is silently dropped. Validation
// considers browser capabilities to allow unsupported actions to be rejected.
export function validateConfig(
    config: unknown,
    defaults: TabzConfig,
): string | null {
    if (typeof config !== "object" || config === null)
        return "Config must be an object";
    const { leader, keys } = config as Record<keyof TabzConfig, unknown>;
    const leaderErr = fieldError(CONFIG_SCHEMA.leader, "Leader", leader);
    if (leaderErr) return leaderErr;
    if (typeof keys !== "object" || keys === null)
        return "Config is missing its key map";

    const caps = detectCapabilities();
    const allowedDefaults = filterConfigByCapabilities(defaults, caps);

    for (const action of Object.keys(keys))
        if (!(action in allowedDefaults.keys))
            return `Unknown or unsupported action "${action}" (not available in this browser)`;
    for (const action of Object.keys(allowedDefaults.keys)) {
        const err = fieldError(
            CONFIG_SCHEMA.key,
            action,
            (keys as Record<string, unknown>)[action],
        );
        if (err) return err;
    }
    return sequenceConflict(keys as Record<TabzAction, string>);
}

let defaultsPromise: Promise<TabzConfig> | undefined;

export function configDefaults(): Promise<TabzConfig> {
    defaultsPromise ??= fetch(chrome.runtime.getURL("config.json")).then(
        (res) => res.json() as Promise<TabzConfig>,
    );
    return defaultsPromise;
}

export async function effectiveConfig(
    defaults: TabzConfig,
): Promise<ParsedConfig> {
    const caps = detectCapabilities();
    const stored = await chrome.storage.sync.get("config");
    const { config, warnings } = parseConfig(defaults, stored["config"]);
    // Filter out browser-unsupported actions
    const filtered = filterConfigByCapabilities(config, caps);

    // Report warnings if features were unavailable
    const unavailableWarnings: string[] = [];
    if (!caps.hasTabGroups)
        unavailableWarnings.push(
            "Tab grouping features are not supported in this browser",
        );
    if (!caps.hasReadingList)
        unavailableWarnings.push(
            "Reading list features are not supported in this browser",
        );

    return {
        config: filtered,
        warnings: [...warnings, ...unavailableWarnings],
    };
}
