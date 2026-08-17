/**
 * Cascade — shell services: panels, toolbar, status bar, modals, toasts,
 * theme, and the HUD.
 *
 * This is the one module every feature module is allowed to lean on besides
 * bus/dom/registry/store/model, because a timer panel and an evidence panel
 * both need "a place to render" and "a way to ask a yes/no question" without
 * knowing anything about each other. Everything here reads and writes the DOM
 * contract elements index.html guarantees exist (#topbar, #sidebar, #dock,
 * #hud, #statusbar, #modal-root) — this file is what makes those ids do
 * something instead of just being containers.
 */

import { $, $$, el, clear } from "./dom.js";
import { register } from "./registry.js";

const THEME_KEY = "cascade.theme";
const DOCK_WIDTH_KEY = "cascade.dockWidth";
const DOCK_COLLAPSED_KEY = "cascade.dockCollapsed";
const SIDEBAR_COLLAPSED_KEY = "cascade.sidebarCollapsed";

// --- Cached DOM references -----------------------------------------------
// Cached once at import time. index.html is parsed before this module (a
// `type="module"` script) runs, so every id in the contract already exists.

const topbarEl = $("#topbar");
const slotLeft = $("#topbar .slot-left");
const slotCenter = $("#topbar .slot-center");
const slotRight = $("#topbar .slot-right");
const sidebarEl = $("#sidebar");
const dockEl = $("#dock");
const dockResizerEl = $("#dock-resizer");
const dockTabsEl = $("#dock-tabs");
const dockBodyEl = $("#dock-body");
const dockCollapseBtn = $("#dock-collapse-toggle");
const sidebarToggleBtn = $("#sidebar-toggle");
const themeToggleBtn = $("#theme-toggle");
const hudEl = $("#hud");
const statusbarEl = $("#statusbar");
const statusSegmentsEl = $("#statusbar-segments");
const modalRootEl = $("#modal-root");
const startScreenEl_ = $("#start-screen");

const SLOTS = { left: slotLeft, center: slotCenter, right: slotRight };

// --- Panels ----------------------------------------------------------------

/** @type {Map<string, {id:string, title:string, icon?:string, order:number, tabEl:HTMLElement, bodyEl:HTMLElement, badgeEl:HTMLElement, onShow?:Function, onHide?:Function}>} */
const panels = new Map();
let activePanelId = null;

/**
 * Register a right-dock panel. `mount(el)` is called once, immediately, so
 * the panel can build its DOM; `onShow`/`onHide` fire on every visibility
 * change so a panel can pause work (a live SVG chart, a timer tick) while
 * it's not on screen.
 * @param {{id:string, title:string, icon?:string, order?:number,
 *   mount:(el:HTMLElement)=>void, onShow?:Function, onHide?:Function}} def
 * @returns {() => void} unregister
 */
export function registerPanel({ id, title, icon, order = 100, mount, onShow, onHide }) {
    if (!id || typeof mount !== "function") {
        throw new Error("registerPanel() needs an id and a mount(el) function");
    }
    if (panels.has(id)) {
        console.warn(`[ui] panel "${id}" is already registered; ignoring`);
        return () => {};
    }

    const badgeEl = el("span.dock-tab-badge", { hidden: true });
    const tabEl = el(
        "button.dock-tab",
        {
            type: "button",
            role: "tab",
            "aria-selected": "false",
            "data-panel-id": id,
            title,
            onClick: () => togglePanel(id),
        },
        icon ? el("span.dock-tab-icon", { text: icon }) : null,
        el("span.dock-tab-label", { text: title }),
        badgeEl,
    );

    const bodyEl = el("div.dock-panel", { role: "tabpanel", "data-panel-id": id, hidden: true });

    const record = { id, title, icon, order, tabEl, bodyEl, badgeEl, onShow, onHide };
    panels.set(id, record);

    // Insert the tab in order among existing tabs rather than always at the end,
    // so a feature module's declared `order` is meaningful regardless of init
    // sequence.
    const siblings = [...dockTabsEl.children];
    const before = siblings.find((node) => {
        const other = panels.get(node.dataset.panelId);
        return other && other.order > order;
    });
    dockTabsEl.insertBefore(tabEl, before ?? null);
    dockBodyEl.append(bodyEl);

    mount(bodyEl);

    // First panel registered becomes the default so the dock is never empty.
    if (!activePanelId) showPanel(id);

    return () => {
        if (activePanelId === id) {
            record.onHide?.();
            activePanelId = null;
        }
        tabEl.remove();
        bodyEl.remove();
        panels.delete(id);
    };
}

/** Show a registered panel, expanding the dock if it was collapsed. */
export function showPanel(id) {
    const record = panels.get(id);
    if (!record) return;
    if (activePanelId === id) return;

    if (activePanelId) {
        const prev = panels.get(activePanelId);
        if (prev) {
            prev.tabEl.setAttribute("aria-selected", "false");
            prev.bodyEl.hidden = true;
            prev.onHide?.();
        }
    }

    activePanelId = id;
    record.tabEl.setAttribute("aria-selected", "true");
    record.bodyEl.hidden = false;
    record.onShow?.();
    setDockCollapsed(false);
}

/** Deselect whatever panel is active, leaving the dock tabs unselected. */
export function hidePanel() {
    if (!activePanelId) return;
    const record = panels.get(activePanelId);
    if (record) {
        record.tabEl.setAttribute("aria-selected", "false");
        record.bodyEl.hidden = true;
        record.onHide?.();
    }
    activePanelId = null;
}

/** Show `id` if it isn't active, otherwise hide it. */
export function togglePanel(id) {
    if (activePanelId === id) hidePanel();
    else showPanel(id);
}

/** The currently active panel id, or null. */
export function activePanel() {
    return activePanelId;
}

/**
 * Set (or clear) a dock tab's badge — used for counts like "3 dropped
 * arguments." Pass a falsy `text` to hide the badge.
 * @param {string} id
 * @param {string|number|null} text
 */
export function setPanelBadge(id, text) {
    const record = panels.get(id);
    if (!record) return;
    const show = text !== null && text !== undefined && text !== "";
    record.badgeEl.hidden = !show;
    record.badgeEl.textContent = show ? String(text) : "";
}

// --- Toolbar -----------------------------------------------------------------

/** @type {Map<string, {btnEl:HTMLElement, labelEl:HTMLElement}>} */
const toolbarButtons = new Map();

/**
 * Add a topbar button.
 * @param {{id:string, label?:string, icon?:string, title?:string,
 *   slot?:"left"|"center"|"right", onClick:Function, active?:boolean}} def
 * @returns {() => void} unregister
 */
export function addToolbarButton({ id, label, icon, title, slot = "right", onClick, active = false }) {
    const target = SLOTS[slot] ?? SLOTS.right;
    if (toolbarButtons.has(id)) {
        console.warn(`[ui] toolbar button "${id}" already exists; ignoring`);
        return () => {};
    }

    const labelEl = el("span.tb-label", { text: label ?? "" });
    const btnEl = el(
        "button.toolbar-btn",
        {
            type: "button",
            "data-btn-id": id,
            title: title ?? label ?? "",
            "aria-label": title ?? label ?? id,
            "aria-pressed": active ? "true" : "false",
            class: active ? "is-active" : "",
            onClick: (e) => onClick?.(e),
        },
        icon ? el("span.tb-icon", { text: icon }) : null,
        label ? labelEl : null,
    );

    target.append(btnEl);
    toolbarButtons.set(id, { btnEl, labelEl });
    return () => {
        btnEl.remove();
        toolbarButtons.delete(id);
    };
}

/**
 * Update a toolbar button's pressed/disabled/label state.
 * @param {string} id
 * @param {{active?:boolean, disabled?:boolean, label?:string}} patch
 */
export function setToolbarButtonState(id, { active, disabled, label } = {}) {
    const record = toolbarButtons.get(id);
    if (!record) return;
    const { btnEl, labelEl } = record;
    if (active !== undefined) {
        btnEl.classList.toggle("is-active", !!active);
        btnEl.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (disabled !== undefined) {
        btnEl.disabled = !!disabled;
    }
    if (label !== undefined) {
        labelEl.textContent = label;
    }
}

// --- Status bar --------------------------------------------------------------

/** @type {Map<string, HTMLElement>} */
const statusSegments = new Map();

/**
 * Set (creating if needed) a right-aligned status bar segment. New segments
 * append after existing ones, so registration order is left-to-right order
 * within the status cluster.
 * @param {string} id
 * @param {string|Node} htmlOrNode  a trusted HTML fragment or a DOM node —
 *   never pass raw user text here (use `esc()` first if you must).
 */
export function setStatus(id, htmlOrNode) {
    let segEl = statusSegments.get(id);
    if (!segEl) {
        segEl = el("span.status-segment", { "data-status-id": id });
        statusSegments.set(id, segEl);
        statusSegmentsEl.append(segEl);
    }
    clear(segEl);
    if (htmlOrNode instanceof Node) {
        segEl.append(htmlOrNode);
    } else {
        segEl.innerHTML = String(htmlOrNode ?? "");
    }
}

/** Remove a status bar segment. */
export function clearStatus(id) {
    const segEl = statusSegments.get(id);
    if (!segEl) return;
    segEl.remove();
    statusSegments.delete(id);
}

// --- Modal / confirm / prompt -------------------------------------------------

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Open a modal dialog. Resolves with the id of the action clicked, or `null`
 * if it was dismissed (Esc, backdrop click, close button).
 * @param {{title:string, body:Node|string, actions?:Array<{id:string,label:string,primary?:boolean,danger?:boolean}>,
 *   width?:number, onMount?:(dialog:HTMLElement)=>void}} opts
 * @returns {Promise<string|null>}
 */
export function modal({ title, body, actions = [], width, onMount }) {
    return new Promise((resolve) => {
        const previouslyFocused = document.activeElement;
        let settled = false;

        const bodyEl = el("div.modal-body");
        if (body instanceof Node) bodyEl.append(body);
        else if (body) bodyEl.append(el("p", { text: body }));

        const actionsEl = el(
            "div.modal-actions",
            null,
            actions.map((a) =>
                el(
                    "button.btn",
                    {
                        type: "button",
                        class: a.danger ? "btn-danger" : a.primary ? "btn-primary" : "btn-ghost",
                        "data-action-id": a.id,
                        onClick: () => finish(a.id),
                    },
                    a.label,
                ),
            ),
        );

        const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
        const dialog = el(
            "div.modal-dialog",
            { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, style: width ? { "--modal-width": `${width}px` } : null },
            el(
                "div.modal-header",
                null,
                el("h2.modal-title", { id: titleId, text: title ?? "" }),
                el("button.modal-close", { type: "button", "aria-label": "Close", onClick: () => finish(null) }, "×"),
            ),
            bodyEl,
            actions.length ? actionsEl : null,
        );

        const backdrop = el("div.modal-backdrop", {
            onClick: (e) => {
                if (e.target === backdrop) finish(null);
            },
        }, dialog);

        function onKeydown(e) {
            if (e.key === "Escape") {
                e.stopPropagation();
                finish(null);
                return;
            }
            if (e.key === "Tab") trapTab(e);
        }

        function trapTab(e) {
            const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled && n.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        function finish(result) {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKeydown, true);
            backdrop.remove();
            if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
            resolve(result);
        }

        modalRootEl.append(backdrop);
        document.addEventListener("keydown", onKeydown, true);

        onMount?.(dialog);

        const primaryBtn = actionsEl.querySelector(".btn-primary");
        const firstFocusable = dialog.querySelector(FOCUSABLE);
        (primaryBtn ?? firstFocusable ?? dialog).focus?.();
    });
}

/**
 * A yes/no confirmation.
 * @param {string} message
 * @param {{title?:string, confirmLabel?:string, danger?:boolean}} [opts]
 * @returns {Promise<boolean>}
 */
export async function confirm(message, { title = "Are you sure?", confirmLabel = "Confirm", danger = false } = {}) {
    const result = await modal({
        title,
        body: message,
        width: 380,
        actions: [
            { id: "cancel", label: "Cancel" },
            { id: "confirm", label: confirmLabel, primary: !danger, danger },
        ],
    });
    return result === "confirm";
}

/**
 * A single-line text prompt.
 * @param {string} message
 * @param {{title?:string, value?:string, placeholder?:string}} [opts]
 * @returns {Promise<string|null>}
 */
export async function prompt(message, { title = "", value = "", placeholder = "" } = {}) {
    let inputEl;
    const body = el(
        "div",
        null,
        message ? el("p", { text: message }) : null,
        (inputEl = el("input", { type: "text", value, placeholder })),
    );

    const result = await modal({
        title,
        body,
        width: 380,
        actions: [
            { id: "cancel", label: "Cancel" },
            { id: "ok", label: "OK", primary: true },
        ],
        onMount: (dialog) => {
            inputEl.focus();
            inputEl.select();
            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    dialog.querySelector('[data-action-id="ok"]')?.click();
                }
            });
        },
    });

    return result === "ok" ? inputEl.value : null;
}

// --- Toasts --------------------------------------------------------------------

let toastStackEl = null;

function ensureToastStack() {
    if (!toastStackEl) {
        toastStackEl = el("div.toast-stack", { "aria-live": "polite" });
        modalRootEl.append(toastStackEl);
    }
    return toastStackEl;
}

/**
 * Show a transient message.
 * @param {string} message
 * @param {{type?:"info"|"success"|"warn"|"error", ms?:number}} [opts]
 */
export function toast(message, { type = "info", ms = 3200 } = {}) {
    const stack = ensureToastStack();
    const node = el("div.toast", { class: type !== "info" ? `toast-${type}` : "", role: "status" }, message);
    stack.append(node);
    const remove = () => node.remove();
    const timer = setTimeout(() => {
        node.classList.add("is-leaving");
        node.addEventListener("animationend", remove, { once: true });
        setTimeout(remove, 400); // fallback if reduced-motion skips the animation event
    }, ms);
    node.addEventListener("click", () => {
        clearTimeout(timer);
        remove();
    });
}

// --- Theme -----------------------------------------------------------------

const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

/** The active theme, `"dark"` or `"light"`. */
export function theme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/**
 * Set and persist the theme.
 * @param {"dark"|"light"} name
 */
export function setTheme(name) {
    const value = name === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", value);
    if (themeToggleBtn) themeToggleBtn.setAttribute("aria-pressed", value === "light" ? "true" : "false");
    try {
        localStorage.setItem(THEME_KEY, value);
    } catch {
        // Private browsing / storage disabled — theme just won't persist.
    }
}

function initTheme() {
    let stored = null;
    try {
        stored = localStorage.getItem(THEME_KEY);
    } catch {
        stored = null;
    }
    if (stored === "dark" || stored === "light") {
        document.documentElement.setAttribute("data-theme", stored);
    } else {
        // No explicit choice yet: follow the OS, and keep following it live
        // until the debater actually picks a theme themselves.
        const applySystem = () => document.documentElement.setAttribute("data-theme", media?.matches ? "light" : "dark");
        applySystem();
        media?.addEventListener?.("change", () => {
            let hasStored = null;
            try {
                hasStored = localStorage.getItem(THEME_KEY);
            } catch {
                hasStored = null;
            }
            if (!hasStored) applySystem();
        });
    }
    if (themeToggleBtn) themeToggleBtn.setAttribute("aria-pressed", theme() === "light" ? "true" : "false");
}

themeToggleBtn?.addEventListener("click", () => setTheme(theme() === "light" ? "dark" : "light"));

// --- HUD -----------------------------------------------------------------------

/** The floating overlay pinned above the grid. */
export function hud() {
    return hudEl;
}

// --- Dock collapse / resize -------------------------------------------------

function setDockCollapsed(collapsed) {
    dockEl.classList.toggle("is-collapsed", collapsed);
    dockCollapseBtn?.setAttribute("aria-pressed", collapsed ? "false" : "true");
    try {
        localStorage.setItem(DOCK_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
        // ignore
    }
}

/** Flip the dock between collapsed and expanded. Registered as the `dock.toggle`
 * command so the desktop menu's "View > Toggle Panel" and the command palette
 * reach the same button the topbar icon does. */
function toggleDock() {
    setDockCollapsed(!dockEl.classList.contains("is-collapsed"));
}

function initDock() {
    let width = 340;
    let collapsed = false;
    try {
        const storedWidth = parseInt(localStorage.getItem(DOCK_WIDTH_KEY), 10);
        if (Number.isFinite(storedWidth)) width = storedWidth;
        collapsed = localStorage.getItem(DOCK_COLLAPSED_KEY) === "1";
    } catch {
        // defaults stand
    }
    dockEl.style.setProperty("--dock-w", `${width}px`);
    setDockCollapsed(collapsed);

    dockCollapseBtn?.addEventListener("click", toggleDock);
    register({ id: "dock.toggle", title: "Toggle panel dock", category: "View", run: toggleDock });

    let dragging = false;
    let startX = 0;
    let startWidth = width;

    dockResizerEl?.addEventListener("mousedown", (e) => {
        dragging = true;
        startX = e.clientX;
        startWidth = dockEl.getBoundingClientRect().width;
        dockResizerEl.classList.add("is-dragging");
        document.body.style.userSelect = "none";
        e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dockMin = 240;
        const dockMax = 640;
        const next = Math.min(dockMax, Math.max(dockMin, startWidth - (e.clientX - startX)));
        dockEl.style.setProperty("--dock-w", `${next}px`);
    });

    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        dockResizerEl.classList.remove("is-dragging");
        document.body.style.userSelect = "";
        const finalWidth = Math.round(dockEl.getBoundingClientRect().width);
        try {
            localStorage.setItem(DOCK_WIDTH_KEY, String(finalWidth));
        } catch {
            // ignore
        }
    });

    // Keyboard resize for the separator (arrow keys), matching its role="separator".
    dockResizerEl?.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const current = dockEl.getBoundingClientRect().width;
        const delta = e.key === "ArrowLeft" ? 16 : -16;
        const next = Math.min(640, Math.max(240, current + delta));
        dockEl.style.setProperty("--dock-w", `${next}px`);
        try {
            localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(next)));
        } catch {
            // ignore
        }
    });
}

// --- Sidebar collapse --------------------------------------------------------

function initSidebar() {
    let collapsed = false;
    try {
        collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
        // ignore
    }
    sidebarEl.classList.toggle("is-collapsed", collapsed);
    sidebarToggleBtn?.setAttribute("aria-pressed", collapsed ? "false" : "true");

    sidebarToggleBtn?.addEventListener("click", () => {
        const next = !sidebarEl.classList.contains("is-collapsed");
        sidebarEl.classList.toggle("is-collapsed", next);
        sidebarToggleBtn.setAttribute("aria-pressed", next ? "false" : "true");
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
        } catch {
            // ignore
        }
    });
}

// --- Start screen ------------------------------------------------------------

/** Reveal the start screen (round not yet open). */
export function showStartScreen() {
    startScreenEl_.hidden = false;
}

/** Hide the start screen (a round is open). */
export function hideStartScreen() {
    startScreenEl_.hidden = true;
}

/** The start screen root element, for exports.js / main.js to wire drag-drop onto. */
export function startScreenEl() {
    return startScreenEl_;
}

/**
 * The event and first-speaker pickers are segmented radio groups for touch/
 * click, but `main.js` reads a single element's `.value` by id
 * (`#start-event`, `#start-first-side`) to build a new round. Rather than
 * make main.js aware of the radio markup, a hidden proxy input mirrors
 * whichever radio is checked — the DOM contract main.js expects stays a
 * one-line `.value` read, and the segmented control stays the nicer touch UI.
 */
function initStartScreenForm() {
    const wire = (radioName, proxyId) => {
        const proxy = $(`#${proxyId}`);
        if (!proxy) return;
        for (const radio of $$(`input[name="${radioName}"]`)) {
            radio.addEventListener("change", () => {
                if (radio.checked) proxy.value = radio.value;
            });
        }
    };
    wire("start-event-radio", "start-event");
    wire("start-first-radio", "start-first-side");
}

/**
 * Make every `role="button"` element in the shell (custom controls like the
 * upload dropzone, which cannot be a real `<button>` because it also accepts
 * drag-and-drop) respond to Enter/Space like a native button does.
 */
function initAccessibleButtons() {
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.getAttribute("role") !== "button") return;
        e.preventDefault();
        target.click();
    });
}

// --- Boot ----------------------------------------------------------------------

initTheme();
initDock();
initSidebar();
initStartScreenForm();
initAccessibleButtons();

/** @type {import("./ui.js")} */
export const ui = {
    registerPanel,
    showPanel,
    hidePanel,
    togglePanel,
    activePanel,
    setPanelBadge,
    addToolbarButton,
    setToolbarButtonState,
    setStatus,
    clearStatus,
    modal,
    confirm,
    prompt,
    toast,
    theme,
    setTheme,
    hud,
    showStartScreen,
    hideStartScreen,
    startScreenEl,
};

export default ui;
