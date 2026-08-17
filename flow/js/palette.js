/**
 * Cascade — command palette, sheet quick-switcher, keyboard cheatsheet, and
 * keymap editor.
 *
 * This module owns the single global `keydown` listener for the whole app.
 * Centralizing it here (instead of letting every feature module add its own)
 * is what lets the keymap editor rebind ANY command's chord and have it just
 * work everywhere, and it's what keeps a debater's typing safe by
 * construction: one guard, checked once, decides whether a keystroke is a
 * command or belongs to the text field the debater is typing in.
 *
 * Every picker (palette, quick-switcher) shares one overlay component so a
 * debater learns the interaction pattern once — search, arrows, Enter, Esc —
 * and it works the same everywhere it shows up, including in blocks.js later.
 */

import {
    register,
    list,
    run,
    bind,
    lookup,
    chordsFor,
    allBindings,
    onChange,
    canonicalChord,
    chordFromEvent,
    prettyChord,
} from "./registry.js";
import { bus } from "./bus.js";
import { el, clear } from "./dom.js";
import { store } from "./store.js";
import { sortedSheets } from "./model.js";
import { ui } from "./ui.js";

// --- Persistence keys ---------------------------------------------------

const RECENT_KEY = "cascade.palette.recent";
const RECENT_CAP = 20;
const KEYMAP_KEY = "cascade.keymap";

// A visible version string keeps the about dialog honest without a build
// step wiring in package.json; bump it by hand alongside real releases.
const VERSION = "0.1.0";

// The "how to flow" primer is fixed prose about grid.js/links.js gestures,
// not something read out of the registry — those commands live in modules
// that register chords no earlier than palette.js does, and the primer is
// about the *product's* core loop, not a listing of whatever happens to be
// bound today. prettyChord() still renders the glyphs correctly per platform
// even for a chord that was never registered.
const PRIMER = [
    { chord: "Tab", text: "Answer an argument in the next column" },
    { chord: "Mod+Enter", text: "Start a new argument in the next column" },
    { chord: "Mod+K", text: "Kill a kicked argument" },
    { chord: "Mod+L", text: "Link an answer to what it answers" },
    { chord: "Mod+Shift+D", text: "Jump to the next dropped argument" },
];

// --- Structural CSS -------------------------------------------------------
// Only layout/box-model rules live here — colors and type come from the
// design tokens app.css already defines, with defensive fallbacks in case
// this module ever loads before the shell's stylesheet does.

const CSS = `
.cp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh var(--space-5, 24px) var(--space-5, 24px);
    background: var(--overlay-scrim, rgba(2, 8, 14, 0.72));
}

.cp-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 640px;
    max-height: 70vh;
    background: var(--bg-2, #0c2438);
    border: 1px solid var(--border-strong, rgba(230, 240, 250, 0.18));
    border-radius: var(--radius-lg, 10px);
    box-shadow: var(--shadow-3, 0 16px 48px rgba(0, 0, 0, 0.45));
    overflow: hidden;
}

.cp-input {
    flex: none;
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-4, 16px);
    border: 0;
    border-bottom: 1px solid var(--border, rgba(230, 240, 250, 0.09));
    background: transparent;
    color: var(--text-0, #f3f7fb);
    font: inherit;
    font-size: 15px;
    outline: none;
}

.cp-list {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-2, 8px);
}

.cp-empty {
    padding: var(--space-5, 24px);
    text-align: center;
    color: var(--text-2, #7e93a6);
    font-size: 13px;
}

.cp-row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: 8px var(--space-3, 12px);
    border-radius: var(--radius-md, 6px);
    cursor: pointer;
    color: var(--text-1, #b7c8d6);
}

.cp-row-active {
    background: var(--bg-3, #123047);
    color: var(--text-0, #f3f7fb);
}

.cp-cmd-icon {
    flex: none;
    width: 20px;
    text-align: center;
    opacity: 0.8;
}

.cp-cmd-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cp-cmd-cat {
    flex: none;
    font-size: 11px;
    color: var(--text-3, #4a6178);
}

.cp-cmd-chord {
    flex: none;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--text-2, #7e93a6);
}

.cp-cmd-disabled {
    opacity: 0.45;
    cursor: default;
}

.cp-match {
    background: none;
    color: var(--d1-accent-2, #38bdf8);
    font-weight: 700;
}

.cp-sheet-side {
    flex: none;
    width: 34px;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 2px 0;
    border-radius: var(--radius-sm, 3px);
}

.cp-side-aff { color: var(--aff, #10b981); border: 1px solid var(--aff, #10b981); }
.cp-side-neg { color: var(--neg, #f43f5e); border: 1px solid var(--neg, #f43f5e); }
.cp-side-cx { color: var(--text-2, #7e93a6); border: 1px solid var(--border-strong, rgba(230, 240, 250, 0.18)); }

/* Cheatsheet ------------------------------------------------------------ */

.cp-cheat-primer-title {
    font-family: var(--font-serif);
    font-weight: 700;
    font-size: 14px;
    margin: 0 0 var(--space-2, 8px);
}

.cp-cheat-primer {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px var(--space-3, 12px);
    margin: 0 0 var(--space-5, 24px);
    padding-bottom: var(--space-4, 16px);
    border-bottom: 1px solid var(--border, rgba(230, 240, 250, 0.09));
}

.cp-cheat-primer dt { margin: 0; }
.cp-cheat-primer dd { margin: 0; color: var(--text-1, #b7c8d6); }

.cp-cheat-cat {
    margin: var(--space-4, 16px) 0 var(--space-2, 8px);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3, #4a6178);
}

.cp-cheat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3, 12px);
    padding: 5px 0;
}

.cp-cheat-title { color: var(--text-0, #f3f7fb); }
.cp-cheat-chords { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.cp-cheat-nochord { color: var(--text-3, #4a6178); font-size: 11px; }

@media print {
    body > *:not(#modal-root) { visibility: hidden; }
    #modal-root { position: static !important; }
    #modal-root * { visibility: visible; }
    .modal-actions { display: none !important; }
    .cp-cheatsheet { color: #000; }
}

/* Keymap editor ---------------------------------------------------------- */

.cp-keymap-hint {
    margin: 0 0 var(--space-3, 12px);
    color: var(--text-2, #7e93a6);
    font-size: 12px;
}

.cp-keymap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3, 12px);
    padding: 6px 0;
    border-bottom: 1px solid var(--border, rgba(230, 240, 250, 0.09));
}

.cp-keymap-title { color: var(--text-0, #f3f7fb); font-size: 13px; }
.cp-keymap-chords { display: flex; gap: 4px; align-items: center; }

.cp-keymap-chord,
.cp-keymap-add {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    padding: 3px 7px;
    border-radius: var(--radius-sm, 3px);
    border: 1px solid var(--border-strong, rgba(230, 240, 250, 0.18));
    background: var(--bg-3, #123047);
    color: var(--text-1, #b7c8d6);
    cursor: pointer;
}

.cp-keymap-chord:hover,
.cp-keymap-add:hover { color: var(--text-0, #f3f7fb); border-color: var(--d1-accent, #0072b1); }

.cp-keymap-chord.cp-capturing {
    color: var(--d1-accent-2, #38bdf8);
    border-color: var(--d1-accent-2, #38bdf8);
}

/* About ------------------------------------------------------------------ */

.cp-about-word {
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 700;
    color: var(--text-0, #f3f7fb);
}

.cp-about-version { color: var(--text-2, #7e93a6); font-size: 12px; margin: 2px 0 var(--space-4, 16px); }
`;

let stylesInjected = false;

/** Inject the structural stylesheet once, lazily, on first overlay use. */
function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.id = "cp-styles";
    style.textContent = CSS;
    document.head.append(style);
}

// --- Fuzzy scoring ---------------------------------------------------------

const CONSEC_BONUS = 15;
// Cost per skipped character when a match does NOT extend the previous one
// consecutively. Without this, a distant word-boundary bonus (e.g. a capital
// letter three words later) could out-score staying on a perfectly good
// contiguous run — e.g. "time" would jump off "Timer" onto the "M" in a
// later "Mute" rather than just matching "Time" straight through. The
// penalty makes that jump pay for the ground it skips, so a literal prefix
// match reliably beats a scattered one.
const GAP_PENALTY = 20;

/**
 * Per-position bonus for `text`: the start of the string scores highest, then
 * the first letter after a separator ("word start"), then a camelCase-style
 * uppercase transition. This is what makes "tsd" prefer "Toggle Sidebar"
 * (T, then S right after a space, then D right after another word start)
 * over a command where t/s/d merely happen to appear in order.
 */
function boundaryBonus(text) {
    const bonus = new Array(text.length);
    let afterSeparator = true;
    for (let j = 0; j < text.length; j++) {
        const ch = text[j];
        const isAlnum = /[A-Za-z0-9]/.test(ch);
        const isUpper = ch >= "A" && ch <= "Z";
        const prevLower = j > 0 && text[j - 1] >= "a" && text[j - 1] <= "z";
        if (j === 0) bonus[j] = 100;
        else if (afterSeparator && isAlnum) bonus[j] = 80;
        else if (isUpper && prevLower) bonus[j] = 60;
        else bonus[j] = 0;
        afterSeparator = !isAlnum;
    }
    return bonus;
}

/**
 * Score `text` as a fuzzy subsequence match for `query`, VS Code / fzf style:
 * consecutive runs and word-boundary starts score higher than a scattered
 * match, and a whole-string prefix scores highest of all (the start-of-string
 * bonus plus every following char's consecutive bonus stacks up fast). This
 * is a real DP over (query length x text length), not a greedy scan, so it
 * finds the best alignment rather than the first one.
 * @param {string} query
 * @param {string} text
 * @returns {{score: number, matches: number[]}|null} matches are indices into `text`; null when query is not a subsequence of text at all
 */
export function fuzzyScore(query, text) {
    if (!query) return { score: 0, matches: [] };
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const qLen = q.length;
    const tLen = t.length;
    if (qLen === 0) return { score: 0, matches: [] };
    if (qLen > tLen) return null;

    const bonus = boundaryBonus(text);
    const NEG = -Infinity;

    // end[i][j]:  best score matching q[0..i) with the i-th query char landing
    //             exactly on t[j] (only meaningful where t[j] === q[i-1]).
    // upto[i][j]: best score matching q[0..i) using any position in t[0..j].
    // uptoArg / fromConsecutive record enough to walk the choice back out for
    // highlighting the matched characters in the rendered title.
    const end = Array.from({ length: qLen + 1 }, () => new Array(tLen).fill(NEG));
    const fromConsecutive = Array.from({ length: qLen + 1 }, () => new Array(tLen).fill(false));
    const upto = Array.from({ length: qLen + 1 }, () => new Array(tLen).fill(NEG));
    const uptoArg = Array.from({ length: qLen + 1 }, () => new Array(tLen).fill(-1));

    for (let i = 1; i <= qLen; i++) {
        for (let j = i - 1; j < tLen; j++) {
            if (t[j] !== q[i - 1]) continue;
            let best = NEG;
            let consecutive = false;
            if (i === 1) {
                best = 0;
            } else if (j > 0) {
                const c = end[i - 1][j - 1];
                const g = upto[i - 1][j - 1];
                const prevPos = uptoArg[i - 1][j - 1];
                const gapped = g === NEG ? NEG : g - GAP_PENALTY * Math.max(0, j - prevPos - 1);
                if (c !== NEG && c + CONSEC_BONUS >= gapped) {
                    best = c + CONSEC_BONUS;
                    consecutive = true;
                } else if (gapped !== NEG) {
                    best = gapped;
                }
            }
            if (best === NEG) continue;
            end[i][j] = best + 1 + bonus[j];
            fromConsecutive[i][j] = consecutive;
        }
        let bestVal = NEG;
        let bestJ = -1;
        for (let j = 0; j < tLen; j++) {
            if (end[i][j] > bestVal) {
                bestVal = end[i][j];
                bestJ = j;
            }
            upto[i][j] = bestVal;
            uptoArg[i][j] = bestJ;
        }
    }

    const total = upto[qLen][tLen - 1];
    if (total === NEG) return null;

    const matches = new Array(qLen);
    let i = qLen;
    let j = uptoArg[qLen][tLen - 1];
    while (i >= 1) {
        matches[i - 1] = j;
        if (fromConsecutive[i][j]) j = j - 1;
        else if (i > 1) j = uptoArg[i - 1][j - 1];
        i--;
    }
    return { score: total, matches };
}

/** Fuzzy-filter and sort a plain list of strings paired with their source items. */
function queryByText(query, items, getText) {
    const q = String(query ?? "").trim();
    if (!q) return items.map((item) => ({ item, score: 0, matches: [] }));
    const scored = [];
    for (const item of items) {
        const m = fuzzyScore(q, getText(item));
        if (m) scored.push({ item, score: m.score, matches: m.matches });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Turn matched character indices into a DOM fragment with `<mark class="cp-match">`
 * runs — built from nodes, never `innerHTML`, because command titles and sheet
 * titles are user-authored text.
 */
function renderMatchedText(text, matches) {
    const frag = document.createDocumentFragment();
    const matchSet = new Set(matches);
    let run_ = "";
    let runMatched = false;
    const flush = () => {
        if (!run_) return;
        frag.append(runMatched ? el("mark.cp-match", {}, run_) : document.createTextNode(run_));
        run_ = "";
    };
    for (let i = 0; i < text.length; i++) {
        const matched = matchSet.has(i);
        if (run_ && matched !== runMatched) flush();
        runMatched = matched;
        run_ += text[i];
    }
    flush();
    return frag;
}

// --- Recently-run commands --------------------------------------------------

function loadRecent() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function saveRecent(ids) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_CAP)));
    } catch {
        // Private browsing / quota — recents are a convenience, not load-bearing.
    }
}

/** Record a command as just-run so it floats to the top of an empty-query palette. */
function recordRecent(id) {
    const ids = loadRecent().filter((existing) => existing !== id);
    ids.unshift(id);
    saveRecent(ids);
}

// --- Keymap overrides --------------------------------------------------------

function loadOverrides() {
    try {
        const raw = localStorage.getItem(KEYMAP_KEY);
        const obj = raw ? JSON.parse(raw) : {};
        return obj && typeof obj === "object" ? obj : {};
    } catch {
        return {};
    }
}

function saveOverrides(obj) {
    try {
        localStorage.setItem(KEYMAP_KEY, JSON.stringify(obj));
    } catch {
        // Same as recents: best-effort persistence, never load-bearing for a round.
    }
}

function persistOverride(chord, commandId) {
    const overrides = loadOverrides();
    overrides[canonicalChord(chord)] = commandId;
    saveOverrides(overrides);
}

function removeOverrideChord(chord) {
    const overrides = loadOverrides();
    delete overrides[canonicalChord(chord)];
    saveOverrides(overrides);
}

// A snapshot of registry.allBindings() taken the first time applyStoredKeymap()
// runs. registry.register() only records *defaults* as commands arrive; by the
// time main.js calls applyStoredKeymap() every module has registered, so that
// is the one moment "the defaults" is a well-defined set worth keeping. Reset
// restores exactly this, not whatever main.js happened to boot with.
let defaultSnapshot = null;

/**
 * Apply this browser's saved keymap overrides on top of the registry's
 * defaults. Call once, from main.js, after every feature module has
 * registered its commands — rebinding a chord before its command exists
 * would silently do nothing.
 */
export function applyStoredKeymap() {
    if (!defaultSnapshot) defaultSnapshot = allBindings();
    const overrides = loadOverrides();
    for (const [chord, commandId] of Object.entries(overrides)) {
        bind(chord, commandId);
    }
}

function resetKeymap() {
    if (!defaultSnapshot) return;
    const current = allBindings();
    // Anything bound now that wasn't in the default snapshot is purely an
    // override's doing (a chord that used to be unbound); drop it first so a
    // stolen key doesn't stay stolen after "reset".
    for (const chord of current.keys()) {
        if (!defaultSnapshot.has(chord)) bind(chord, null);
    }
    for (const [chord, id] of defaultSnapshot) {
        bind(chord, id);
    }
    saveOverrides({});
}

// --- Command index (registry has no get-by-id in its public API) -----------

let commandIndex = new Map();

function rebuildIndex() {
    commandIndex = new Map(list({ includeHidden: true }).map((cmd) => [cmd.id, cmd]));
}

function commandById(id) {
    return commandIndex.get(id);
}

// --- Global keydown dispatch -------------------------------------------------

function isTextEntry(target) {
    if (!target || typeof target !== "object") return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return Boolean(target.isContentEditable);
}

/** True when a chord carries Mod, Alt, or Ctrl — Shift alone doesn't count, since Shift+letter is how a capital letter gets typed. */
function hasQualifyingModifier(chord) {
    const parts = chord.split("+");
    parts.pop();
    return parts.includes("Mod") || parts.includes("Alt") || parts.includes("Ctrl");
}

// Set while the keymap editor is waiting for the next keypress to bind. While
// this is non-null the dispatcher hands the raw chord to it instead of
// running a command — otherwise "press a key to rebind" would immediately
// trigger whatever that key already does.
let captureCallback = null;

function beginCapture(cb) {
    captureCallback = cb;
}

function onGlobalKeydown(e) {
    const chord = chordFromEvent(e);
    if (!chord) return; // a bare modifier key by itself

    if (captureCallback) {
        e.preventDefault();
        e.stopPropagation();
        const cb = captureCallback;
        captureCallback = null;
        cb(chord === "Escape" ? null : chord);
        return;
    }

    if (chord === "Escape") {
        // Any open overlay (palette, cheatsheet's own modal, a picker) closes
        // off this one signal instead of each maintaining its own listener.
        bus.emit("ui:escape");
        e.preventDefault();
        return;
    }

    if (isTextEntry(e.target) && !hasQualifyingModifier(chord)) return;

    const id = lookup(chord);
    if (!id) return;
    const cmd = commandById(id);
    if (!cmd || (cmd.when && !cmd.when())) return;

    recordRecent(id);
    run(id);
    e.preventDefault();
}

// --- Reusable overlay --------------------------------------------------------

/**
 * A centered search-and-pick overlay: search input, scrollable result list,
 * arrow keys / Ctrl+N / Ctrl+P to move, Enter to pick, Esc to close (via the
 * `ui:escape` bus topic, so it closes the same way every other overlay does).
 * Shared by the command palette and the sheet quick-switcher; blocks.js can
 * use the same look for its picker.
 * @param {object} opts
 * @param {string} [opts.placeholder]
 * @param {any[]|() => any[]} opts.items          static array, or a function called fresh each query (so a late-registered command shows up)
 * @param {(entry: {item, score, matches}, state: {active: boolean, index: number}) => Node} opts.render
 * @param {(item: any, entry: {item, score, matches}) => void} opts.onPick
 * @param {(query: string, items: any[]) => {item, score, matches}[]} [opts.onQuery]  defaults to fuzzy-matching String(item.title ?? item.label ?? item)
 * @param {() => void} [opts.onClose]
 * @param {string} [opts.initialQuery]
 * @param {string} [opts.emptyText]
 * @returns {{close: () => void, refresh: () => void, setQuery: (q: string) => void, el: HTMLElement}}
 */
export function pickerOverlay({
    placeholder = "",
    items = [],
    render,
    onPick,
    onQuery,
    onClose,
    initialQuery = "",
    emptyText = "No matches",
} = {}) {
    injectStyles();

    const previouslyFocused = document.activeElement;
    let entries = [];
    let activeIndex = 0;
    let closed = false;

    const input = el("input.cp-input", {
        type: "text",
        placeholder,
        value: initialQuery,
        autocomplete: "off",
        spellcheck: false,
        "aria-label": placeholder || "Search",
    });
    const listEl = el("div.cp-list", { role: "listbox" });
    const empty = el("div.cp-empty", { text: emptyText, style: { display: "none" } });
    const panel = el("div.cp-panel", { role: "dialog", "aria-modal": "true" }, input, listEl, empty);
    const backdrop = el("div.cp-backdrop", {
        onMousedown: (e) => {
            if (e.target === backdrop) close();
        },
    }, panel);

    function getItems() {
        return typeof items === "function" ? items() : items;
    }

    function defaultQuery(q, source) {
        return queryByText(q, source, (item) => String(item?.title ?? item?.label ?? item));
    }

    function renderList() {
        clear(listEl);
        if (!entries.length) {
            empty.style.display = "";
            return;
        }
        empty.style.display = "none";
        entries.forEach((entry, i) => {
            const row = render(entry, { active: i === activeIndex, index: i });
            row.classList.add("cp-row");
            row.classList.toggle("cp-row-active", i === activeIndex);
            row.addEventListener("mousemove", () => setActive(i));
            row.addEventListener("mousedown", (e) => {
                e.preventDefault();
                pick(i);
            });
            listEl.append(row);
        });
        listEl.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function setActive(i) {
        if (!entries.length) return;
        activeIndex = Math.max(0, Math.min(entries.length - 1, i));
        [...listEl.children].forEach((row, idx) => row.classList.toggle("cp-row-active", idx === activeIndex));
        listEl.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    function runQuery(q) {
        entries = onQuery ? onQuery(q, getItems()) : defaultQuery(q, getItems());
        activeIndex = 0;
        renderList();
    }

    function pick(i) {
        const entry = entries[i];
        if (!entry) return;
        onPick?.(entry.item, entry);
    }

    function close() {
        if (closed) return;
        closed = true;
        unsubEscape();
        backdrop.remove();
        if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
        onClose?.();
    }

    input.addEventListener("input", () => runQuery(input.value));
    input.addEventListener("keydown", (e) => {
        const lower = e.key.toLowerCase();
        if (e.key === "ArrowDown" || (e.ctrlKey && lower === "n")) {
            e.preventDefault();
            setActive(activeIndex + 1);
        } else if (e.key === "ArrowUp" || (e.ctrlKey && lower === "p")) {
            e.preventDefault();
            setActive(activeIndex - 1);
        } else if (e.key === "Enter") {
            e.preventDefault();
            pick(activeIndex);
        }
        // Escape is deliberately not handled here — the global dispatcher
        // (capture phase, fires first regardless) turns it into "ui:escape"
        // and this overlay listens for that below, same as every other one.
    });

    const unsubEscape = bus.on("ui:escape", close);

    document.body.append(backdrop);
    runQuery(initialQuery);
    queueMicrotask(() => input.focus());

    return { close, refresh: () => runQuery(input.value), setQuery: (q) => { input.value = q; runQuery(q); }, el: backdrop };
}

// Only one picker overlay open at a time; opening a second closes the first.
let closeActiveOverlay = () => {};

function openOverlay(build) {
    closeActiveOverlay();
    const overlay = build();
    closeActiveOverlay = overlay.close;
    return overlay;
}

// --- Command palette ---------------------------------------------------------

function chordsLabel(id) {
    const chords = chordsFor(id);
    return chords.length ? prettyChord(chords[0]) : "";
}

function renderCommandRow(entry) {
    const cmd = entry.item;
    const available = !cmd.when || cmd.when();
    const row = el(
        "div.cp-cmd-row",
        { role: "option", "aria-disabled": String(!available) },
        el("span.cp-cmd-icon", { text: cmd.icon || "" }),
        el("span.cp-cmd-title", {}, renderMatchedText(cmd.title, entry.matches)),
        el("span.cp-cmd-cat", { text: cmd.category }),
        el("span.cp-cmd-chord", { text: chordsLabel(cmd.id) }),
    );
    if (!available) row.classList.add("cp-cmd-disabled");
    return row;
}

function queryCommands(query, cmds, recentIds) {
    const q = query.trim();
    if (!q) {
        const byId = new Map(cmds.map((c) => [c.id, c]));
        const head = recentIds.map((id) => byId.get(id)).filter(Boolean);
        const headSet = new Set(head.map((c) => c.id));
        const rest = cmds.filter((c) => !headSet.has(c.id));
        return [...head, ...rest].map((item) => ({ item, score: 0, matches: [] }));
    }
    // A small recency boost only breaks near-ties — a strong prefix match on
    // a command you haven't touched still beats a weak match on one you have.
    const recentBoost = new Map(recentIds.map((id, i) => [id, recentIds.length - i]));
    const scored = [];
    for (const cmd of cmds) {
        const m = fuzzyScore(q, cmd.title);
        if (!m) continue;
        scored.push({ item: cmd, score: m.score + (recentBoost.get(cmd.id) ?? 0), matches: m.matches });
    }
    scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
    return scored;
}

function openCommandPalette() {
    const recent = loadRecent();
    let unsubChange = null;
    openOverlay(() => {
        const overlay = pickerOverlay({
            placeholder: "Type a command…",
            items: () => list(),
            onQuery: (q, cmds) => queryCommands(q, cmds, recent),
            render: renderCommandRow,
            onPick: (cmd) => {
                if (cmd.when && !cmd.when()) return; // dimmed rows aren't runnable
                recordRecent(cmd.id);
                overlay.close();
                run(cmd.id);
            },
            onClose: () => unsubChange?.(),
            emptyText: "No matching commands",
        });
        // A feature module registered after the palette opened (or a keymap
        // rebind) should show up without the debater having to close and
        // reopen — that's the whole point of onChange existing.
        unsubChange = onChange(() => overlay.refresh());
        return overlay;
    });
}

// --- Sheet quick-switcher -----------------------------------------------------

function sheetSideLabel(sheet) {
    if (sheet.kind === "cx") return "CX";
    return sheet.group === "neg" ? "NEG" : "AFF";
}

function renderSheetRow(entry) {
    const sheet = entry.item;
    const rowCount = Array.isArray(sheet.data) ? sheet.data.length : 0;
    return el(
        "div.cp-cmd-row",
        { role: "option" },
        el("span.cp-sheet-side", { class: `cp-side-${sheet.kind === "cx" ? "cx" : sheet.group}`, text: sheetSideLabel(sheet) }),
        el("span.cp-cmd-title", {}, renderMatchedText(sheet.title || "(untitled)", entry.matches)),
        el("span.cp-cmd-cat", { text: `${rowCount} row${rowCount === 1 ? "" : "s"}` }),
    );
}

function openSheetSwitcher() {
    openOverlay(() =>
        pickerOverlay({
            placeholder: "Go to sheet…",
            items: () => sortedSheets(store.round),
            onQuery: (q, sheets) => queryByText(q, sheets, (s) => s.title || ""),
            render: renderSheetRow,
            onPick: (sheet, entry) => {
                closeActiveOverlay();
                store.setActiveSheet(sheet.id);
            },
            emptyText: "No sheets",
        }),
    );
}

// --- Keyboard cheatsheet -------------------------------------------------------

function buildCheatsheetBody() {
    const root = el("div.cp-cheatsheet");
    root.append(el("h3.cp-cheat-primer-title", { text: "How to flow in Cascade" }));
    const primerList = el("dl.cp-cheat-primer");
    for (const { chord, text } of PRIMER) {
        primerList.append(el("dt", {}, el("kbd", { text: prettyChord(chord) })), el("dd", { text }));
    }
    root.append(primerList);

    const groups = new Map();
    for (const cmd of list({ includeHidden: true })) {
        const cat = cmd.category || "General";
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(cmd);
    }
    for (const [cat, cmds] of groups) {
        root.append(el("h4.cp-cheat-cat", { text: cat }));
        for (const cmd of cmds) {
            const chords = chordsFor(cmd.id);
            const chordsHost = el("span.cp-cheat-chords");
            if (chords.length) {
                for (const chord of chords) chordsHost.append(el("kbd", { text: prettyChord(chord) }));
            } else {
                chordsHost.append(el("span.cp-cheat-nochord", { text: "unbound" }));
            }
            root.append(el("div.cp-cheat-row", {}, el("span.cp-cheat-title", { text: cmd.title }), chordsHost));
        }
    }
    return root;
}

function openCheatsheet() {
    ui.modal({
        title: "Keyboard Cheatsheet",
        body: buildCheatsheetBody(),
        width: 720,
        actions: [
            { id: "print", label: "Print" },
            { id: "close", label: "Close", primary: true },
        ],
    }).then((action) => {
        if (action === "print") window.print();
    });
}

// --- Keymap editor -----------------------------------------------------------

function makeChordButton(commandId, chord, rerender) {
    const btn = el("button.cp-keymap-chord", { type: "button", text: chord ? prettyChord(chord) : "unbound" });
    btn.addEventListener("click", () => startCapture(chord, commandId, btn, rerender));
    return btn;
}

function startCapture(oldChord, commandId, btn, rerender) {
    btn.classList.add("cp-capturing");
    const originalText = btn.textContent;
    btn.textContent = "Press a key…";
    beginCapture((newChord) => {
        btn.classList.remove("cp-capturing");
        if (!newChord) {
            btn.textContent = originalText;
            return; // Escape cancelled the capture
        }
        finishCapture(oldChord, newChord, commandId, rerender);
    });
}

async function finishCapture(oldChord, newChord, commandId, rerender) {
    const owner = lookup(newChord);
    if (owner && owner !== commandId) {
        const ownerCmd = commandById(owner);
        const steal = await ui.confirm(
            `${prettyChord(newChord)} is already bound to "${ownerCmd?.title ?? owner}". Steal it for this command instead?`,
            { title: "Shortcut already in use", confirmLabel: "Steal it", danger: true },
        );
        if (!steal) {
            rerender();
            return;
        }
    }
    if (oldChord && canonicalChord(oldChord) !== canonicalChord(newChord)) {
        bind(oldChord, null);
        removeOverrideChord(oldChord);
    }
    bind(newChord, commandId);
    persistOverride(newChord, commandId);
    rerender();
}

function buildKeymapBody() {
    const root = el("div.cp-keymap");
    root.append(el("p.cp-keymap-hint", { text: "Click a shortcut, then press the new key combination. Esc cancels." }));
    const listHost = el("div.cp-keymap-list");
    for (const cmd of list({ includeHidden: true })) {
        const row = el("div.cp-keymap-row", {}, el("span.cp-keymap-title", { text: cmd.title }));
        const chordsHost = el("span.cp-keymap-chords");
        row.append(chordsHost);
        const rerenderRow = () => {
            clear(chordsHost);
            const current = chordsFor(cmd.id);
            if (current.length) {
                for (const chord of current) chordsHost.append(makeChordButton(cmd.id, chord, rerenderRow));
            } else {
                chordsHost.append(makeChordButton(cmd.id, null, rerenderRow));
            }
            const addBtn = el("button.cp-keymap-add", { type: "button", text: "+", title: "Add another shortcut" });
            addBtn.addEventListener("click", () => startCapture(null, cmd.id, addBtn, rerenderRow));
            chordsHost.append(addBtn);
        };
        rerenderRow();
        listHost.append(row);
    }
    root.append(listHost);
    return root;
}

async function openKeymapEditor() {
    if (!defaultSnapshot) applyStoredKeymap(); // guard against being opened before boot calls it
    const action = await ui.modal({
        title: "Keyboard Shortcuts",
        body: buildKeymapBody(),
        width: 640,
        actions: [
            { id: "reset", label: "Reset to Defaults", danger: true },
            { id: "done", label: "Done", primary: true },
        ],
    });
    if (action === "reset") {
        const ok = await ui.confirm(
            "Reset every shortcut to Cascade's defaults? Your custom bindings will be lost.",
            { title: "Reset keyboard shortcuts", confirmLabel: "Reset", danger: true },
        );
        if (ok) resetKeymap();
        return openKeymapEditor(); // reopen so the debater sees the result, without a full page reload
    }
}

// --- About ---------------------------------------------------------------

function openAbout() {
    const body = el(
        "div.cp-about",
        el("div.cp-about-word", { text: "Cascade" }),
        el("div.cp-about-version", { text: `Version ${VERSION}` }),
        el("p", {
            text: "Cascade reads and writes ebb-compatible .ebb files, so a flow moves between Cascade and ebb without conversion.",
        }),
        el(
            "p",
            {},
            "Built for ",
            el("a", { href: "https://debate101.org", target: "_blank", rel: "noopener", text: "Debate 101" }),
            ". File format credit: the ",
            el("a", { href: "https://github.com/shreerammodi/ebb", target: "_blank", rel: "noopener", text: "ebb" }),
            " project.",
        ),
    );
    ui.modal({ title: "About Cascade", body, actions: [{ id: "close", label: "Close", primary: true }] });
}

// --- Own commands + boot ---------------------------------------------------

function registerOwnCommands() {
    register({
        id: "palette.open",
        title: "Command Palette",
        category: "General",
        icon: "⌘",
        keys: ["Mod+Shift+P"],
        run: openCommandPalette,
    });
    register({
        id: "sheet.quickSwitch",
        title: "Go to Sheet…",
        category: "Navigation",
        icon: "#",
        keys: ["Mod+P"],
        run: openSheetSwitcher,
    });
    register({
        id: "help.open",
        title: "Keyboard Cheatsheet",
        category: "Help",
        icon: "?",
        // The physical key is "?", but chordFromEvent reports the Shift that
        // physically produces it — registering "Shift+?" is what actually
        // matches the chord a keydown for "?" resolves to.
        keys: ["Shift+?"],
        run: openCheatsheet,
    });
    register({
        id: "help.keymap",
        title: "Edit Keyboard Shortcuts…",
        category: "Help",
        icon: "⌨",
        run: openKeymapEditor,
    });
    register({
        id: "help.about",
        title: "About Cascade",
        category: "Help",
        icon: "i",
        run: openAbout,
    });
}

/**
 * Wire up the palette layer: register its own commands, start the global
 * keydown dispatcher, and keep an id->command index fresh for lookups the
 * registry's public API doesn't offer directly. Called once by main.js.
 */
export function init() {
    registerOwnCommands();
    rebuildIndex();
    onChange(rebuildIndex);
    window.addEventListener("keydown", onGlobalKeydown, true);
}

export const palette = { init, applyStoredKeymap, pickerOverlay, fuzzyScore };
export default palette;
