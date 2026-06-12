// Tabz content script: a window-level key listener plus a small shadow-DOM
// HUD; no other DOM mutation. Every key in the grammar, including the "s"
// leader, is deliberately absent from Vimium's default bindings. That matters
// because listener registration order between extensions is unspecified: if
// Vimium's capture handler runs first, it would swallow any bound key even in
// the middle of one of our sequences.

const LEADER = "s";
const SEQUENCE_TIMEOUT_MS = 2000;
const COUNT_LIMIT = 99;
const TOAST_MS = 1600;
const PREVIEW_DEBOUNCE_MS = 80;

const SEQUENCE_COMMANDS: Record<string, (count: number) => TabzCommand> = {
  "w": (count) => ({ type: "move", delta: -count }),
  "e": (count) => ({ type: "move", delta: count }),
  "0": () => ({ type: "moveEdge", edge: "start" }),
  "$": () => ({ type: "moveEdge", edge: "end" }),
  "c": () => ({ type: "createGroup" }),
  "a": () => ({ type: "joinGroup" }),
  "q": () => ({ type: "ungroup" }),
  "Q": () => ({ type: "dissolveGroup" }),
  "s": () => ({ type: "prompt" }),
};

interface ParseResult {
  handled: boolean;
  command?: TabzCommand;
}

function createSequenceParser(now: () => number = Date.now) {
  let countBuf = "";
  let pending = false;
  let lastAt = 0;

  function reset(): void {
    countBuf = "";
    pending = false;
  }

  function feed(key: string): ParseResult {
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

    const make = SEQUENCE_COMMANDS[key];
    if (!make) {
      reset();
      return { handled: false };
    }
    const count = Math.min(COUNT_LIMIT, parseInt(countBuf || "1", 10));
    reset();
    return { handled: true, command: make(count) };
  }

  return { feed, reset };
}

function isEditableTarget(event: Event): boolean {
  const target = (event.composedPath && event.composedPath()[0]) || event.target;
  if (!target || (target as Node).nodeType !== 1) return false;
  const el = target as HTMLElement;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

type SendFn = (msg: TabzMessage) => Promise<TabzResponse>;

interface PromptRefs {
  input: HTMLInputElement;
  status: HTMLSpanElement;
}

function createHud(send: SendFn) {
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let prompt: PromptRefs | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  function render(body: string): ShadowRoot {
    if (!host || !host.isConnected) {
      host = document.createElement("tabz-hud");
      host.style.cssText =
        "position:fixed !important;left:50% !important;bottom:28px !important;" +
        "transform:translateX(-50%) !important;z-index:2147483647 !important;";
      shadow = host.attachShadow({ mode: "open" });
      (document.body || document.documentElement).appendChild(host);
    }
    shadow!.innerHTML = `<style>
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
    return shadow!;
  }

  function close(): void {
    clearTimeout(previewTimer);
    prompt = null;
    if (host) host.remove();
  }

  function toast(text: string): void {
    const root = render('<div class="box"><span class="msg"></span></div>');
    root.querySelector(".msg")!.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (!prompt) close();
    }, TOAST_MS);
  }

  function setStatus(text: string, isError: boolean): void {
    if (!prompt) return;
    prompt.status.textContent = text;
    prompt.status.className = isError ? "status err" : "status";
  }

  function schedulePreview(): void {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (!prompt) return;
      const pattern = prompt.input.value;
      if (!pattern) return setStatus("", false);
      const res = await send({ type: "countMatches", pattern });
      if (!prompt || prompt.input.value !== pattern) return;
      setStatus(
        res.ok ? `${res.count} match${res.count === 1 ? "" : "es"}` : res.notice || "",
        !res.ok
      );
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function submit(): Promise<void> {
    if (!prompt) return;
    const pattern = prompt.input.value;
    if (!pattern) return close();
    const res = await send({ type: "closeMatches", pattern });
    if (!prompt) return;
    if (res.ok && res.count! > 0) {
      close();
      toast(res.notice || "");
    } else {
      setStatus(res.ok ? "0 matches" : res.notice || "", !res.ok);
    }
  }

  function openPrompt(): void {
    const root = render(
      '<div class="box"><span>close tabs matching</span>' +
        '<input type="text" spellcheck="false" autocomplete="off"><span class="status"></span></div>'
    );
    prompt = {
      input: root.querySelector("input")!,
      status: root.querySelector(".status")!,
    };
    prompt.input.addEventListener("input", schedulePreview);
    prompt.input.addEventListener("blur", close);
    prompt.input.focus();
  }

  // While the prompt is open, keep keystrokes away from the page and from any
  // other extension listening on window; characters still land in the input
  // through the browser's default action, which stopImmediatePropagation does
  // not cancel.
  function handlePromptKey(event: KeyboardEvent): void {
    event.stopImmediatePropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return { toast, openPrompt, handlePromptKey, promptOpen: () => prompt !== null };
}

function install(): void {
  const send: SendFn = (msg) =>
    chrome.runtime
      .sendMessage(msg)
      .catch((err: Error) => ({ ok: false, notice: `Tabz: ${err.message || err}` }));
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
    true
  );
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) install();
