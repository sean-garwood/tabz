// Browser capability detection for feature flags.
// Determines which APIs are available at runtime to support both Chrome and Firefox.

export interface BrowserCapabilities {
    // Chrome-only APIs
    hasTabGroups: boolean;
    hasReadingList: boolean;
}

export function detectCapabilities(): BrowserCapabilities {
    return {
        hasTabGroups: typeof chrome !== "undefined" && "tabGroups" in chrome,
        hasReadingList: typeof chrome !== "undefined" && "readingList" in chrome,
    };
}
