const VALIDATE_DEBOUNCE_MS = 150;

const ACTION_LABELS: Record<TabzAction, string> = {
    moveLeft: "Move tab left",
    moveRight: "Move tab right",
    moveStart: "Move tab to first position",
    moveEnd: "Move tab to last position",
    createGroup: "Create group from current tab",
    joinGroup: "Add tab to nearest group",
    ungroup: "Remove tab from its group",
    dissolveGroup: "Dissolve tab's group",
    regexClose: "Open the regex-close prompt",
};

function sendMessage(msg: TabzMessage): Promise<TabzResponse> {
    return chrome.runtime.sendMessage(msg).catch((err: Error) => ({
        ok: false as const,
        notice: `Tabz: ${err.message || err}`,
    }));
}

function requireEl<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Tabz options: missing ${selector}`);
    return el;
}

function bindingRow(action: TabzAction, key: string): HTMLTableRowElement {
    const row = document.createElement("tr");

    const label = document.createElement("td");
    label.textContent = ACTION_LABELS[action];

    const cell = document.createElement("td");
    const input = document.createElement("input");
    input.maxLength = 1;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.action = action;
    input.value = key;
    cell.appendChild(input);

    const seq = document.createElement("td");
    seq.className = "seq";

    row.append(label, cell, seq);
    return row;
}

async function initOptions() {
    const form = requireEl<HTMLFormElement>("#config-form");
    const leaderInput = requireEl<HTMLInputElement>("#leader");
    const bindings = requireEl<HTMLTableSectionElement>("#bindings");
    const status = requireEl<HTMLElement>("#status");
    const saveButton = requireEl<HTMLButtonElement>("#save");
    const resetButton = requireEl<HTMLButtonElement>("#reset");

    function setStatus(text: string, isError: boolean) {
        status.textContent = text;
        status.className = isError ? "err" : "";
    }

    const res = await sendMessage({ type: "getConfig" });
    if (!res.ok || !res.config) {
        setStatus(res.ok ? "Could not load config" : res.notice, true);
        return;
    }
    const { current, defaults } = res.config;
    const actions = Object.keys(defaults.keys) as TabzAction[];

    for (const action of actions)
        bindings.appendChild(bindingRow(action, current.keys[action]));
    leaderInput.value = current.leader;

    const keyInputs = [...bindings.querySelectorAll<HTMLInputElement>("input")];

    function readConfig(): TabzConfig {
        const keys = {} as Record<TabzAction, string>;
        for (const input of keyInputs)
            keys[input.dataset.action as TabzAction] = input.value;
        return { leader: leaderInput.value, keys };
    }

    function refreshPreviews() {
        for (const input of keyInputs) {
            const seq = input.closest("tr")?.querySelector(".seq");
            if (seq) seq.textContent = leaderInput.value + input.value;
        }
    }

    // Validation lives in the service worker; the page only relays results,
    // so the rules cannot drift between live feedback and save.
    let validateRun = 0;
    async function revalidate() {
        const run = ++validateRun;
        const result = await sendMessage({
            type: "validateConfig",
            config: readConfig(),
        });
        if (run !== validateRun) return;
        saveButton.disabled = !result.ok;
        setStatus(result.ok ? "" : result.notice, !result.ok);
    }

    function fill(config: TabzConfig) {
        leaderInput.value = config.leader;
        for (const input of keyInputs)
            input.value = config.keys[input.dataset.action as TabzAction];
        refreshPreviews();
    }

    let validateTimer = 0;
    form.addEventListener("input", () => {
        refreshPreviews();
        clearTimeout(validateTimer);
        validateTimer = window.setTimeout(revalidate, VALIDATE_DEBOUNCE_MS);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await sendMessage({
            type: "setConfig",
            config: readConfig(),
        });
        setStatus(
            result.ok ? (result.notice ?? "Saved") : result.notice,
            !result.ok,
        );
    });

    resetButton.addEventListener("click", () => {
        fill(defaults);
        saveButton.disabled = false;
        setStatus("Defaults restored; press Save to apply", false);
    });

    refreshPreviews();
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id)
    initOptions();
