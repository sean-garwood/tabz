// Shared message protocol between the content script and the service worker.
// Ambient declarations (no imports/exports) keep both source files classic
// scripts: MV3 content scripts cannot be ES modules, so the compiled output
// must have no module wrapper.

type TabzMessage =
  | { type: "move"; delta: number }
  | { type: "moveEdge"; edge: "start" | "end" }
  | { type: "createGroup" }
  | { type: "joinGroup" }
  | { type: "ungroup" }
  | { type: "dissolveGroup" }
  | { type: "countMatches"; pattern: string }
  | { type: "closeMatches"; pattern: string };

// "prompt" is content-script-internal: it opens the regex HUD and is never
// sent to the service worker.
type TabzCommand = TabzMessage | { type: "prompt" };

interface TabzResponse {
  ok: boolean;
  notice?: string;
  count?: number;
}
