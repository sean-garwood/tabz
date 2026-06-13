const SEQUENCE_TIMEOUT_MS = 2000;
const CONFIG_RETRY_DELAYS_MS = [500, 1000, 2000];
const COUNT_LIMIT = 99;
const TOAST_MS = 1600;
const PREVIEW_DEBOUNCE_MS = 80;

type CommandFactory = (count: number) => TabzCommand;

const ACTION_COMMANDS: Record<TabzAction, CommandFactory> = {
    moveLeft: (count) => ({ type: "move", delta: -count }),
    moveRight: (count) => ({ type: "move", delta: count }),
    moveStart: () => ({ type: "moveEdge", edge: "start" }),
    moveEnd: () => ({ type: "moveEdge", edge: "end" }),
    createGroup: () => ({ type: "createGroup" }),
    joinGroup: () => ({ type: "joinGroup" }),
    ungroup: () => ({ type: "ungroup" }),
    dissolveGroup: () => ({ type: "dissolveGroup" }),
    regexClose: () => ({ type: "prompt" }),
    closeDups: () => ({ type: "closeDups" }),
    readingListAdd: () => ({ type: "readingListAdd" }),
    readingListRemove: () => ({ type: "readingListRemove" }),
};

interface TrieNode {
    children: Map<string, TrieNode>;
    factory?: CommandFactory;
}

// Bindings are validated prefix-free by the service worker, so every factory
// sits on a leaf and a walk can never pass through a complete sequence.
function buildSequenceTrie(config: TabzConfig): TrieNode {
    const root: TrieNode = { children: new Map() };
    for (const action of Object.keys(ACTION_COMMANDS) as TabzAction[]) {
        const seq = config.keys[action];
        if (!seq) continue;
        let node = root;
        for (const char of seq) {
            let next = node.children.get(char);
            if (!next) {
                next = { children: new Map() };
                node.children.set(char, next);
            }
            node = next;
        }
        node.factory = ACTION_COMMANDS[action];
    }
    return root;
}

function createSequenceParser(config: TabzConfig, now = Date.now) {
    const root = buildSequenceTrie(config);
    // The cursor is null while idle; the leader sets it to the trie root and
    // each matched sequence character advances it.
    let cursor: TrieNode | null = null;
    let countBuf = "";
    let lastAt = 0;

    function reset() {
        countBuf = "";
        cursor = null;
    }

    function feed(key: string): { handled: boolean; command?: TabzCommand } {
        const at = now();
        if (at - lastAt > SEQUENCE_TIMEOUT_MS) reset();
        lastAt = at;

        const isDigit = key >= "0" && key <= "9";
        // A bare "0" is the move-to-start command, vim-style; it only counts as a
        // digit when a count is already in progress.
        const isCountDigit = isDigit && !(key === "0" && countBuf === "");

        if (!cursor) {
            if (key === config.leader) {
                cursor = root;
                return { handled: true };
            }
            countBuf = isCountDigit ? countBuf + key : "";
            return { handled: false };
        }

        if (key === "Escape") {
            reset();
            return { handled: true };
        }
        // Digits extend the count only before the sequence starts; mid-walk
        // they are ordinary keys (1-9 are unbindable, so they reset below).
        if (isCountDigit && cursor === root) {
            countBuf += key;
            return { handled: true };
        }

        const next = cursor.children.get(key);
        if (!next) {
            reset();
            return { handled: false };
        }
        if (!next.factory) {
            cursor = next;
            return { handled: true };
        }
        const count = Math.min(COUNT_LIMIT, parseInt(countBuf || "1", 10));
        reset();
        return { handled: true, command: next.factory(count) };
    }

    return { feed, reset };
}

interface EditableElement {
    nodeType: number;
    tagName: string;
    isContentEditable?: boolean;
}

function isEditableElement(el: unknown): el is EditableElement {
    return (
        typeof el === "object" &&
        el !== null &&
        "nodeType" in el &&
        "tagName" in el
    );
}

function isEditableTarget(
    event:
        | Event
        | { composedPath?: () => EventTarget[]; target: EventTarget | null },
): boolean {
    const el = (event.composedPath?.() ?? [])[0] ?? event.target;
    if (!isEditableElement(el) || el.nodeType !== 1) return false;
    return (
        el.isContentEditable === true ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
    );
}

function createHud(send: TabzSendFn) {
    let hud: { host: HTMLElement; shadow: ShadowRoot } | null = null;
    let prompt: { input: HTMLInputElement; status: HTMLElement } | null = null;
    let toastTimer = 0;
    let previewTimer = 0;

    function render(body: string): ShadowRoot {
        if (!hud || !hud.host.isConnected) {
            const host = document.createElement("tabz-hud");
            host.style.cssText =
                "position:fixed !important;left:50% !important;bottom:28px !important;" +
                "transform:translateX(-50%) !important;z-index:2147483647 !important;";
            const shadow = host.attachShadow({ mode: "open" });
            (document.body || document.documentElement).appendChild(host);
            hud = { host, shadow };
        }
        hud.shadow.innerHTML = `<style>
      :host { all: initial; }
      .box { display: flex; align-items: center; gap: 8px; white-space: nowrap;
             font: 12px/1.4 system-ui, sans-serif; color: #e6edf3; background: #1c2128;
             border: 1px solid #444c56; border-radius: 8px; padding: 8px 12px;
             box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); }
      input { width: 240px; font: 13px/1.2 ui-monospace, monospace; color: #e6edf3;
              background: #0d1117; border: 1px solid #444c56; border-radius: 4px;
              padding: 4px 6px; outline: none; }
      .status { color: #8b949e; min-width: 80px; }
      .status.err { color: #f85149; }
    </style>${body}`;
        return hud.shadow;
    }

    function close() {
        clearTimeout(previewTimer);
        prompt = null;
        const host = hud?.host;
        hud = null;
        if (host?.isConnected) host.remove();
    }

    function toast(text: string) {
        const root = render('<div class="box"><span class="msg"></span></div>');
        const msg = root.querySelector(".msg");
        if (msg) msg.textContent = text;
        clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            if (!prompt) close();
        }, TOAST_MS);
    }

    function setStatus(text: string, isError: boolean) {
        if (!prompt) return;
        prompt.status.textContent = text;
        prompt.status.className = isError ? "status err" : "status";
    }

    function schedulePreview() {
        clearTimeout(previewTimer);
        previewTimer = window.setTimeout(async () => {
            if (!prompt) return;
            const pattern = prompt.input.value;
            if (!pattern) return setStatus("", false);
            const res = await send({ type: "countMatches", pattern });
            if (!prompt || prompt.input.value !== pattern) return;
            setStatus(
                res.ok
                    ? `${res.count ?? 0} match${res.count === 1 ? "" : "es"}`
                    : res.notice,
                !res.ok,
            );
        }, PREVIEW_DEBOUNCE_MS);
    }

    async function submit() {
        if (!prompt) return;
        const pattern = prompt.input.value;
        if (!pattern) return close();
        const res = await send({ type: "closeMatches", pattern });
        if (!prompt) return;
        if (res.ok && (res.count ?? 0) > 0) {
            close();
            toast(res.notice ?? "");
        } else {
            setStatus(res.ok ? "0 matches" : res.notice, !res.ok);
        }
    }

    function openPrompt() {
        const root = render(
            '<div class="box"><span>close tabs matching</span>' +
                '<input type="text" spellcheck="false" autocomplete="off"><span class="status"></span></div>',
        );
        const input = root.querySelector<HTMLInputElement>("input");
        const status = root.querySelector<HTMLElement>(".status");
        if (!input || !status) return;
        prompt = { input, status };
        prompt.input.addEventListener("input", schedulePreview);
        prompt.input.addEventListener("blur", close);
        prompt.input.focus();
    }

    function handlePromptKey(event: KeyboardEvent) {
        event.stopImmediatePropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            submit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            close();
        }
    }

    return {
        toast,
        openPrompt,
        handlePromptKey,
        promptOpen: () => prompt !== null,
    };
}

function install() {
    const hud = createHud(tabzSendMessage);
    let parser: ReturnType<typeof createSequenceParser> | undefined;

    // Keys pass through untouched until the config arrives; the parser is
    // rebuilt whenever the user saves new bindings on the options page.
    // Failures (worker mid-restart, extension just updated) are retried with
    // backoff; if they persist, the top frame warns once instead of leaving
    // the user to discover that no binding works.
    async function loadConfig() {
        for (const delayMs of [...CONFIG_RETRY_DELAYS_MS, null]) {
            const res = await tabzSendMessage({ type: "getConfig" });
            if (res.ok) {
                parser = createSequenceParser(res.config.current);
                return;
            }
            if (delayMs === null) {
                if (window === window.top)
                    hud.toast("Tabz: key bindings failed to load");
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    loadConfig();
    chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "sync") loadConfig();
    });

    window.addEventListener(
        "keydown",
        (event) => {
            if (hud.promptOpen()) return hud.handlePromptKey(event);
            if (!parser) return;
            if (event.defaultPrevented || event.isComposing) return;
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key.length !== 1 && event.key !== "Escape") return;
            if (isEditableTarget(event)) return;

            const action = parser.feed(event.key);
            if (!action.handled) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!action.command) return;
            if (action.command.type === "prompt") return hud.openPrompt();
            tabzSendMessage(action.command).then((res) => {
                if (res && res.notice) hud.toast(res.notice);
            });
        },
        true,
    );
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)
    install();
