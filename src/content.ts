const LEADER = "s";
const SEQUENCE_TIMEOUT_MS = 2000;
const COUNT_LIMIT = 99;
const TOAST_MS = 1600;
const PREVIEW_DEBOUNCE_MS = 80;

const SEQUENCE_COMMANDS = {
    w: (count: number): TabzCommand => ({ type: "move", delta: -count }),
    e: (count: number): TabzCommand => ({ type: "move", delta: count }),
    0: (): TabzCommand => ({ type: "moveEdge", edge: "start" }),
    $: (): TabzCommand => ({ type: "moveEdge", edge: "end" }),
    c: (): TabzCommand => ({ type: "createGroup" }),
    a: (): TabzCommand => ({ type: "joinGroup" }),
    q: (): TabzCommand => ({ type: "ungroup" }),
    Q: (): TabzCommand => ({ type: "dissolveGroup" }),
    s: (): TabzCommand => ({ type: "prompt" }),
};

type SequenceKey = `${keyof typeof SEQUENCE_COMMANDS}`;

function isSequenceKey(key: string): key is SequenceKey {
    return key in SEQUENCE_COMMANDS;
}

function createSequenceParser(now = Date.now) {
    let countBuf = "";
    let pending = false;
    let lastAt = 0;

    function reset() {
        countBuf = "";
        pending = false;
    }

    function feed(key: string): { handled: boolean; command?: TabzCommand } {
        const at = now();
        if (at - lastAt > SEQUENCE_TIMEOUT_MS) reset();
        lastAt = at;

        const isDigit = key >= "0" && key <= "9";
        // A bare "0" is the move-to-start command, vim-style; it only counts as a
        // digit when a count is already in progress.
        const isCountDigit = isDigit && !(key === "0" && countBuf === "");

        if (!pending) {
            if (key === LEADER) {
                pending = true;
                return { handled: true };
            }
            countBuf = isCountDigit ? countBuf + key : "";
            return { handled: false };
        }

        if (key === "Escape") {
            reset();
            return { handled: true };
        }
        if (isCountDigit) {
            countBuf += key;
            return { handled: true };
        }

        if (!isSequenceKey(key)) {
            reset();
            return { handled: false };
        }
        const count = Math.min(COUNT_LIMIT, parseInt(countBuf || "1", 10));
        reset();
        return { handled: true, command: SEQUENCE_COMMANDS[key](count) };
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

function createHud(send: (msg: TabzMessage) => Promise<TabzResponse>) {
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
        if (hud) hud.host.remove();
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
    const send = (msg: TabzMessage): Promise<TabzResponse> =>
        chrome.runtime.sendMessage(msg).catch((err: Error) => ({
            ok: false as const,
            notice: `Tabz: ${err.message || err}`,
        }));
    const hud = createHud(send);
    const parser = createSequenceParser();

    window.addEventListener(
        "keydown",
        (event) => {
            if (hud.promptOpen()) return hud.handlePromptKey(event);
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
            send(action.command).then((res) => {
                if (res && res.notice) hud.toast(res.notice);
            });
        },
        true,
    );
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)
    install();
