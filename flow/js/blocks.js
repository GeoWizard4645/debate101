/**
 * Cascade — Feature 4: Block Library & Autotext.
 *
 * A debater who has to retype "perm do both" or a T shell from scratch every
 * round is losing prep time to typing speed. This module keeps a library of
 * canned blocks (a team's shared shells plus this round's one-offs) and gets
 * them onto the flow two ways: typing `;trigger` + Tab in a cell (the fast
 * path, meant to be invisible once it's in a debater's fingers), or a fuzzy
 * picker (`Mod+Shift+B`) for when you can't remember the exact trigger.
 *
 * Storage is split on purpose: the shared library lives in `localStorage`
 * under `cascade.blocks` so it survives across every round and machine reset
 * that keeps browser storage, while round-only scratch blocks live in
 * `round.cascade.blocks` so they travel inside the `.ebb` file itself and
 * disappear with the round if that's what the debater wants. Both scopes are
 * shown together, badged, everywhere blocks are listed.
 */

import { bus } from "./bus.js";
import { el, $, clear, download, debounce, modKey, MOD_LABEL } from "./dom.js";
import { register } from "./registry.js";
import { uid, ensureCascade } from "./model.js";
import { store } from "./store.js";
import { ui } from "./ui.js";

// --- Constants ---------------------------------------------------------------

const LS_KEY = "cascade.blocks";
const LS_SEEDED_KEY = "cascade.blocks.seeded";
const EVENT_SCOPES = new Set(["any", "policy", "ld", "pf", "parli"]);

// A trigger is a `;` immediately followed by a word (letters, digits,
// underscore, hyphen) sitting right at the caret — anchored with `$` so it
// only fires when the caret is directly after the candidate word, not
// somewhere later in the cell.
const TRIGGER_RE = /;([A-Za-z][\w-]*)$/;

// --- Module state --------------------------------------------------------------

/** @type {Array<object>} the shared library, loaded from localStorage */
let libraryCache = [];
/** @type {HTMLElement|null} the grid's live edit textarea, tracked via focusin */
let activeEditor = null;
/** @type {{search: HTMLInputElement, groupsEl: HTMLElement}|null} panel DOM refs, once mounted */
let panelRefs = null;
/** tag -> collapsed? (persists group open/closed state across re-renders) */
const collapsedState = {};
/** @type {HTMLElement|null} the fuzzy picker overlay, while open */
let pickerEl = null;
let pickerState = { items: [], index: 0 };

// --- Storage: shared library (localStorage) -------------------------------------

/**
 * Load the shared library from localStorage. Corrupt or missing data yields
 * an empty library rather than throwing — a bad JSON blob left over from a
 * crashed tab must not take down block support for the whole app.
 */
function loadLibrary() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((b) => b && typeof b === "object").map(normalizeBlock);
    } catch (err) {
        console.error("[blocks] cascade.blocks was corrupt; starting fresh", err);
        return [];
    }
}

/**
 * Persist the shared library. Quota errors (Safari private mode, or a
 * library that grew huge) are caught and surfaced as a toast instead of
 * crashing — the debater keeps working, they just know this edit didn't stick.
 */
function saveLibrary(list) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(list));
        return true;
    } catch (err) {
        console.error("[blocks] failed to save cascade.blocks", err);
        ui.toast?.("Block library couldn't be saved (storage full?)", { type: "error" });
        return false;
    }
}

/** Fill in defaults so a block from disk/import always has every field. */
function normalizeBlock(raw) {
    return {
        id: typeof raw.id === "string" && raw.id ? raw.id : uid("block"),
        trigger: String(raw.trigger ?? "").trim().replace(/^;/, ""),
        title: String(raw.title ?? ""),
        body: String(raw.body ?? ""),
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string" && t) : [],
        event: EVENT_SCOPES.has(raw.event) ? raw.event : "any",
        uses: Number.isFinite(raw.uses) ? raw.uses : 0,
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
}

// --- Storage: round-scoped blocks ----------------------------------------------

/** `round.cascade.blocks`, defensively (never throws even mid-boot). */
function roundBlocksRaw() {
    try {
        return store.cascade?.blocks ?? [];
    } catch {
        return [];
    }
}

// --- Merge, lookup, ranking ------------------------------------------------------

/**
 * Every block from both scopes, each tagged with where it lives so the UI
 * can badge it. Sorted alphabetically by trigger for stable browsing; search
 * and the picker re-rank on top of this.
 */
function allBlocks() {
    const roundBlocks = roundBlocksRaw().map((b) => ({ ...normalizeBlock(b), scope: "round" }));
    const libBlocks = libraryCache.map((b) => ({ ...b, scope: "library" }));
    return [...libBlocks, ...roundBlocks].sort((a, b) => a.trigger.localeCompare(b.trigger));
}

/**
 * The block a typed trigger word resolves to, case-insensitive. A round
 * block wins over a library block with the same trigger — this round's
 * override (e.g. a case-specific "perm" shell) beats the team default.
 */
function findTriggerBlock(word) {
    const w = word.toLowerCase();
    let roundMatch = null;
    let libMatch = null;
    for (const b of allBlocks()) {
        if (b.trigger.toLowerCase() !== w) continue;
        if (b.scope === "round") roundMatch = b;
        else if (!libMatch) libMatch = b;
    }
    return roundMatch || libMatch;
}

/**
 * Subsequence fuzzy score: every character of `query` must appear in `text`
 * in order (not necessarily contiguous). Returns null on no match, otherwise
 * a score where higher is better — consecutive-match runs and a leading
 * prefix match are both rewarded, so typing "perm" ranks the block whose
 * trigger literally *is* "perm" above one where "perm" only shows up buried
 * in a tag.
 */
function fuzzyScore(query, text) {
    const q = query.toLowerCase();
    const t = (text || "").toLowerCase();
    if (!q) return 0;
    let qi = 0;
    let score = 0;
    let streak = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            qi++;
            streak++;
            score += 1 + streak;
        } else {
            streak = 0;
        }
    }
    if (qi < q.length) return null;
    if (t.startsWith(q)) score += 10;
    return score;
}

/** Rank every block against a query by trigger/title/tags, then by uses. */
function rankBlocks(query) {
    const q = (query || "").trim();
    const scored = [];
    for (const block of allBlocks()) {
        const haystacks = [block.trigger, block.title, ...(block.tags || [])];
        let best = q ? null : 0;
        for (const h of haystacks) {
            const s = fuzzyScore(q, h);
            if (s !== null && (best === null || s > best)) best = s;
        }
        if (best === null) continue;
        scored.push({ block, score: best });
    }
    scored.sort(
        (a, b) =>
            b.score - a.score ||
            (b.block.uses || 0) - (a.block.uses || 0) ||
            a.block.trigger.localeCompare(b.block.trigger),
    );
    return scored;
}

/** Public: ranked blocks matching a query (used by the panel search too). */
function find(query) {
    return rankBlocks(query).map((r) => r.block);
}

/** Bump a block's use counter and persist it, in whichever scope it lives. */
function touchUse(block) {
    if (block.scope === "round") {
        store.commit(
            (round) => {
                const cascade = ensureCascade(round);
                const b = cascade.blocks.find((x) => x.id === block.id);
                if (b) {
                    b.uses = (b.uses || 0) + 1;
                    b.updatedAt = Date.now();
                }
            },
            { coalesce: `block-use-${block.id}`, silent: true },
        );
    } else {
        const idx = libraryCache.findIndex((x) => x.id === block.id);
        if (idx >= 0) {
            libraryCache[idx] = {
                ...libraryCache[idx],
                uses: (libraryCache[idx].uses || 0) + 1,
                updatedAt: Date.now(),
            };
            saveLibrary(libraryCache);
        }
    }
}

/**
 * Push a block onto the grid. `newRow: true` splits a multi-line body into
 * one new row per line (the picker's Mod+Enter, and Shift+Tab expansion);
 * otherwise the whole body — newlines and all — lands in the current cell.
 */
function insertBlock(block, { newRow = false } = {}) {
    if (!block) return;
    if (newRow) {
        for (const line of block.body.split("\n")) {
            bus.emit("grid:insertText", { text: line, newRow: true });
        }
    } else {
        bus.emit("grid:insertText", { text: block.body, newRow: false });
    }
    touchUse(block);
}

// --- Trigger expansion (Tab in the grid's cell editor) ----------------------------

function isTextEditor(node) {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName;
    return tag === "TEXTAREA" || (tag === "INPUT" && (node.type === "text" || node.type === "search"));
}

function dispatchInputEvent(target) {
    // grid.js owns the textarea and reacts to its own "input" handling to pick
    // up the new cell text; we never call into grid.js directly (feature
    // modules don't import each other), so faking the same DOM event it
    // already listens for is how the edit actually lands on the flow.
    target.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Replace the `;trigger` text with the block's body, in place, in the
 * textarea grid.js is currently editing.
 *
 * Caret math: `match.index` is the offset of the leading `;` within `before`
 * (the text from column 0 up to the caret) — since `before` is itself a
 * prefix of `value` starting at 0, that offset is identical in `value`. The
 * caret sits at `target.selectionStart`, which is exactly the end of the
 * matched trigger word (the regex is anchored with `$`), so `before`/`after`
 * split the trigger out cleanly with nothing off-by-one.
 */
function expandTrigger(target, match, block, asRows) {
    const value = target.value;
    const triggerStart = match.index;
    const triggerEnd = target.selectionStart;
    const before = value.slice(0, triggerStart);
    const after = value.slice(triggerEnd);
    if (asRows) {
        // Shift+Tab-to-expand: drop the trigger from this cell, then push the
        // body in as one new row per line — a multi-line shell lands the way
        // a debater would hand-flow it, one tag per row, instead of jammed
        // into a single cell.
        target.value = before + after;
        target.setSelectionRange(before.length, before.length);
        dispatchInputEvent(target);
        for (const line of block.body.split("\n")) {
            bus.emit("grid:insertText", { text: line, newRow: true });
        }
    } else {
        const next = before + block.body + after;
        target.value = next;
        const caret = before.length + block.body.length;
        target.setSelectionRange(caret, caret);
        dispatchInputEvent(target);
    }
    touchUse(block);
}

function onGridKeydown(e) {
    if (e.key !== "Tab") return; // only Tab expands; everything else is grid.js's business
    const target = e.target;
    if (!isTextEditor(target)) return; // defensive: not editing a cell, let Tab through untouched
    const caret = target.selectionStart;
    if (caret == null || caret !== target.selectionEnd) return; // a real selection isn't a caret to expand from
    const before = target.value.slice(0, caret);
    const match = TRIGGER_RE.exec(before);
    if (!match) return; // nothing trigger-shaped right before the caret; let Tab move columns as normal
    const block = findTriggerBlock(match[1]);
    if (!block) return; // unknown trigger, probably a typo — don't eat the keystroke on a guess
    e.preventDefault();
    e.stopPropagation();
    expandTrigger(target, match, block, e.shiftKey);
}

/**
 * Hook Tab-to-expand without touching grid.js. A capture-phase listener on
 * `#grid-host` sees keydowns before grid.js's own column-move handling, so we
 * can preventDefault/stopPropagation to swallow the Tab only when it actually
 * expands a trigger — every other Tab passes through untouched. The focusin
 * listener just keeps a live reference to whichever textarea grid.js is
 * currently editing with, for anything else in this module that needs to
 * know "what am I typing into right now" (defensive bookkeeping; expansion
 * itself always re-reads `e.target` fresh).
 */
function bindGridHost() {
    const host = $("#grid-host");
    if (!host) return; // grid isn't mounted (e.g. running outside the shell) — nothing to hook
    host.addEventListener("keydown", onGridKeydown, true);
    host.addEventListener(
        "focusin",
        (e) => {
            if (isTextEditor(e.target)) activeEditor = e.target;
        },
        true,
    );
}

// --- Fuzzy picker overlay (Mod+Shift+B) --------------------------------------------

function closePicker() {
    pickerEl?.remove();
    pickerEl = null;
}

function renderPickerList(listEl, preview) {
    clear(listEl);
    if (!pickerState.items.length) {
        listEl.append(el("div.blocks-picker-empty", "No matching blocks."));
        renderPickerPreview(preview);
        return;
    }
    pickerState.items.forEach((item, i) => {
        const b = item.block;
        const row = el(
            "div.blocks-picker-row",
            {
                role: "option",
                "aria-selected": i === pickerState.index ? "true" : "false",
                class: i === pickerState.index ? "is-active" : "",
                onMousedown: (ev) => {
                    ev.preventDefault(); // keep focus (and the caret) in the search input
                    insertBlock(b, { newRow: modKey(ev) || ev.shiftKey });
                    closePicker();
                },
                onMouseenter: () => {
                    pickerState.index = i;
                    renderPickerList(listEl, preview);
                },
            },
            el("span.blocks-picker-trigger", `;${b.trigger}`),
            el("span.blocks-picker-title", b.title || ""),
            el("span.blocks-picker-scope", b.scope),
        );
        listEl.append(row);
    });
    renderPickerPreview(preview);
}

function renderPickerPreview(preview) {
    clear(preview);
    const item = pickerState.items[pickerState.index];
    if (!item) return;
    preview.append(el("pre.blocks-picker-body", item.block.body));
}

function movePicker(delta, listEl, preview) {
    const n = pickerState.items.length;
    if (!n) return;
    pickerState.index = (pickerState.index + delta + n) % n;
    renderPickerList(listEl, preview);
}

function onPickerKeydown(e, listEl, preview) {
    if (e.key === "Escape") {
        e.preventDefault();
        closePicker();
        return;
    }
    if (e.key === "ArrowDown") {
        e.preventDefault();
        movePicker(1, listEl, preview);
        return;
    }
    if (e.key === "ArrowUp") {
        e.preventDefault();
        movePicker(-1, listEl, preview);
        return;
    }
    if (e.key === "Enter") {
        e.preventDefault();
        const item = pickerState.items[pickerState.index];
        if (!item) return;
        // Mod+Enter (or Shift+Enter, for one-handed use) inserts as a new row;
        // a bare Enter drops the body straight into the current cell.
        insertBlock(item.block, { newRow: modKey(e) || e.shiftKey });
        closePicker();
    }
}

/** Open the fuzzy block picker, centered over the grid. */
function openPicker() {
    if (pickerEl) return; // already open
    const host = $("#grid-host");
    const rect = host?.getBoundingClientRect() ?? {
        top: 80,
        left: 80,
        width: window.innerWidth - 160,
        height: window.innerHeight - 160,
    };
    const overlay = el("div.blocks-picker-overlay", {
        role: "dialog",
        "aria-label": "Block picker",
        style: {
            position: "fixed",
            inset: "0",
            zIndex: "1000",
            background: "rgba(0,0,0,0.35)",
        },
        onMousedown: (e) => {
            if (e.target === overlay) closePicker();
        },
    });
    const panel = el("div.blocks-picker", {
        style: {
            position: "fixed",
            top: `${rect.top + rect.height * 0.12}px`,
            left: `${rect.left + rect.width / 2}px`,
            transform: "translateX(-50%)",
            width: `${Math.min(560, Math.max(320, rect.width * 0.8))}px`,
            maxHeight: `${rect.height * 0.72}px`,
            display: "flex",
            flexDirection: "column",
            background: "var(--d1-navy, #0b1d29)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "8px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            padding: "10px",
            gap: "8px",
        },
    });
    const input = el("input.blocks-picker-input", {
        type: "text",
        placeholder: `Search blocks…  Enter inserts · ${MOD_LABEL}+Enter new row · Esc closes`,
        style: { width: "100%", boxSizing: "border-box" },
    });
    const list = el("div.blocks-picker-list", {
        role: "listbox",
        style: { overflowY: "auto", flex: "1 1 auto" },
    });
    const preview = el("div.blocks-picker-preview", {
        style: { borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: "6px" },
    });
    panel.append(input, list, preview);
    overlay.append(panel);
    document.body.append(overlay);
    pickerEl = overlay;

    const update = () => {
        pickerState = { items: rankBlocks(input.value), index: 0 };
        renderPickerList(list, preview);
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => onPickerKeydown(e, list, preview));
    update();
    input.focus();
}

// --- Dock panel: CRUD, grouping, import/export --------------------------------------

/**
 * Open the create/edit modal for a block. Resolves once the modal closes;
 * returns `true` when saved, `null` when cancelled or invalid.
 */
async function openBlockEditor(existing) {
    const isNew = !existing;
    const draft = existing ?? { trigger: "", title: "", body: "", tags: [], event: "any", scope: "library" };

    const triggerInput = el("input", { type: "text", value: draft.trigger, placeholder: "perm" });
    const titleInput = el("input", { type: "text", value: draft.title, placeholder: "Perm — do both" });
    const bodyInput = el("textarea", {
        rows: 8,
        placeholder: "One tag-shaped line per row…",
        style: { width: "100%", boxSizing: "border-box", fontFamily: "inherit" },
        text: draft.body,
    });
    bodyInput.value = draft.body; // el()'s "text" prop sets textContent, which also seeds the textarea's value
    const tagsInput = el("input", {
        type: "text",
        value: (draft.tags || []).filter((t) => t !== "starter").join(", "),
        placeholder: "theory, perm",
    });
    const eventSelect = el(
        "select",
        {},
        ...[...EVENT_SCOPES].map((id) => el("option", { value: id, selected: draft.event === id }, id)),
    );
    const scopeSelect = isNew
        ? el(
              "select",
              {},
              el("option", { value: "library", selected: true }, "Shared library (every round)"),
              el("option", { value: "round" }, "This round only"),
          )
        : null;

    const rows = [
        el("label", {}, "Trigger (after \";\")", triggerInput),
        el("label", {}, "Title", titleInput),
        el("label", {}, "Body", bodyInput),
        el("label", {}, "Tags (comma-separated)", tagsInput),
        el("label", {}, "Event", eventSelect),
    ];
    if (scopeSelect) rows.push(el("label", {}, "Save to", scopeSelect));
    const body = el("div.blocks-editor", { style: { display: "flex", flexDirection: "column", gap: "10px" } }, rows);

    const action = await ui.modal({
        title: isNew ? "New block" : `Edit block — ;${draft.trigger}`,
        body,
        actions: [
            { id: "save", label: "Save", primary: true },
            { id: "cancel", label: "Cancel" },
        ],
        width: 520,
    });
    if (action !== "save") return null;

    const trigger = triggerInput.value.trim().replace(/^;/, "");
    const text = bodyInput.value;
    if (!trigger || !text.trim()) {
        ui.toast?.("A block needs at least a trigger and a body.", { type: "error" });
        return null;
    }
    const tags = tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (isNew && (draft.tags || []).includes("starter")) tags.push("starter");
    const patch = {
        trigger,
        title: titleInput.value.trim(),
        body: text,
        tags,
        event: eventSelect.value,
    };
    if (isNew) {
        createBlock(patch, scopeSelect.value);
    } else {
        updateBlock(draft.id, patch, draft.scope);
    }
    return true;
}

function createBlock(data, scope) {
    const block = normalizeBlock({ id: uid("block"), uses: 0, updatedAt: Date.now(), ...data });
    if (scope === "round") {
        store.commit(
            (round) => {
                ensureCascade(round).blocks.push(block);
            },
            { label: "New block" },
        );
    } else {
        libraryCache = [...libraryCache, block];
        saveLibrary(libraryCache);
    }
    renderPanel();
    return block;
}

function updateBlock(id, patch, scope) {
    if (scope === "round") {
        store.commit(
            (round) => {
                const cascade = ensureCascade(round);
                const b = cascade.blocks.find((x) => x.id === id);
                if (b) Object.assign(b, patch, { updatedAt: Date.now() });
            },
            { label: "Edit block" },
        );
    } else {
        const idx = libraryCache.findIndex((x) => x.id === id);
        if (idx >= 0) {
            libraryCache[idx] = { ...libraryCache[idx], ...patch, updatedAt: Date.now() };
            saveLibrary(libraryCache);
        }
    }
    renderPanel();
}

function duplicateBlock(b) {
    const copy = normalizeBlock({
        ...b,
        id: uid("block"),
        trigger: `${b.trigger}-copy`,
        title: b.title ? `${b.title} (copy)` : b.title,
        uses: 0,
        updatedAt: Date.now(),
        tags: (b.tags || []).filter((t) => t !== "starter"), // a copy is no longer "the" seeded example
    });
    if (b.scope === "round") {
        store.commit(
            (round) => {
                ensureCascade(round).blocks.push(copy);
            },
            { label: "Duplicate block" },
        );
    } else {
        libraryCache = [...libraryCache, copy];
        saveLibrary(libraryCache);
    }
    renderPanel();
}

async function deleteBlockWithConfirm(b) {
    const ok = await ui.confirm(`Delete block ";${b.trigger}"? This can't be undone.`, {
        title: "Delete block",
        confirmLabel: "Delete",
        danger: true,
    });
    if (!ok) return;
    if (b.scope === "round") {
        store.commit(
            (round) => {
                const cascade = ensureCascade(round);
                cascade.blocks = cascade.blocks.filter((x) => x.id !== b.id);
            },
            { label: "Delete block" },
        );
    } else {
        libraryCache = libraryCache.filter((x) => x.id !== b.id);
        saveLibrary(libraryCache);
    }
    renderPanel();
}

function exportLibrary() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), blocks: libraryCache };
    download("cascade-blocks.json", JSON.stringify(payload, null, 2), "application/json");
    ui.toast?.("Exported block library", { type: "success" });
}

/**
 * Merge an imported block set into the shared library by trigger. New
 * triggers are added outright; a trigger that collides with one already in
 * the library is only overwritten after the user confirms — a teammate's
 * export must not silently clobber edits made locally.
 */
async function mergeImportedBlocks(incoming) {
    const byTrigger = new Map(libraryCache.map((b) => [b.trigger.toLowerCase(), b]));
    const fresh = [];
    const conflicts = [];
    for (const b of incoming) {
        const key = (b.trigger || "").toLowerCase();
        if (key && byTrigger.has(key)) conflicts.push(b);
        else fresh.push(b);
    }
    let overwrite = false;
    if (conflicts.length) {
        overwrite = await ui.confirm(
            `${conflicts.length} imported block${conflicts.length === 1 ? "" : "s"} share a trigger with ` +
                `blocks you already have (${conflicts.map((b) => `;${b.trigger}`).join(", ")}). Overwrite them?`,
            { title: "Import blocks", confirmLabel: "Overwrite", danger: false },
        );
    }
    for (const b of fresh) {
        libraryCache.push(normalizeBlock({ ...b, id: uid("block"), uses: 0, updatedAt: Date.now() }));
    }
    if (overwrite) {
        for (const b of conflicts) {
            const existing = byTrigger.get(b.trigger.toLowerCase());
            Object.assign(existing, {
                title: b.title ?? existing.title,
                body: b.body ?? existing.body,
                tags: Array.isArray(b.tags) ? b.tags : existing.tags,
                event: EVENT_SCOPES.has(b.event) ? b.event : existing.event,
                updatedAt: Date.now(),
            });
        }
    }
    saveLibrary(libraryCache);
    renderPanel();
    const skipped = conflicts.length && !overwrite ? conflicts.length : 0;
    ui.toast?.(
        `Imported ${fresh.length} new block${fresh.length === 1 ? "" : "s"}` +
            (overwrite ? `, updated ${conflicts.length}` : "") +
            (skipped ? `, skipped ${skipped} (kept yours)` : ""),
        { type: "success" },
    );
}

function importLibraryPrompt() {
    const input = el("input", { type: "file", accept: "application/json,.json", style: { display: "none" } });
    document.body.append(input);
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const incoming = Array.isArray(data) ? data : Array.isArray(data?.blocks) ? data.blocks : null;
            if (!incoming) throw new Error("no blocks[] array found");
            await mergeImportedBlocks(incoming.filter((b) => b && typeof b === "object"));
        } catch (err) {
            console.error("[blocks] import failed", err);
            ui.toast?.("Couldn't import — not a valid blocks file.", { type: "error" });
        }
    });
    input.click();
}

function renderBlockRow(b) {
    const row = el(
        "div.blocks-row",
        { class: b.tags?.includes("starter") ? "is-starter" : "" },
        el(
            "span.blocks-badge",
            { class: `scope-${b.scope}`, title: b.scope === "round" ? "This round only" : "Shared library" },
            b.scope === "round" ? "round" : "library",
        ),
        el("span.blocks-trigger", `;${b.trigger}`),
        el("span.blocks-title", b.title || ""),
        b.tags?.includes("starter")
            ? el("span.blocks-starter-flag", { title: "Starter example — edit or delete freely" }, "example")
            : null,
        el("span.blocks-uses", { title: "times used" }, `${b.uses || 0}×`),
        el(
            "span.blocks-rowactions",
            el("button", { type: "button", title: "Edit", onClick: () => openBlockEditor(b) }, "✎"),
            el("button", { type: "button", title: "Duplicate", onClick: () => duplicateBlock(b) }, "⧉"),
            el("button", { type: "button", title: "Delete", onClick: () => deleteBlockWithConfirm(b) }, "🗑"),
        ),
    );
    return row;
}

function renderGroups(container, query) {
    clear(container);
    const q = (query || "").trim();
    const items = q ? find(q) : allBlocks();
    // Group by tag; a block with several tags is filed under each so a
    // debater browsing any one relevant tag finds it.
    const groups = new Map();
    for (const b of items) {
        const tags = b.tags && b.tags.length ? b.tags : ["untagged"];
        for (const tag of tags) {
            if (!groups.has(tag)) groups.set(tag, []);
            groups.get(tag).push(b);
        }
    }
    const tagNames = [...groups.keys()].sort((a, b) => a.localeCompare(b));
    if (!tagNames.length) {
        container.append(el("p.blocks-empty", "No blocks match."));
        return;
    }
    for (const tag of tagNames) {
        const blocksInGroup = groups.get(tag);
        const details = el("details.blocks-group", { open: collapsedState[tag] !== true });
        details.addEventListener("toggle", () => {
            collapsedState[tag] = !details.open;
        });
        details.append(el("summary", {}, `${tag} `, el("span.count", `(${blocksInGroup.length})`)));
        for (const b of blocksInGroup) details.append(renderBlockRow(b));
        container.append(details);
    }
}

/** Re-render the panel's block list, if it's mounted. */
function renderPanel() {
    if (!panelRefs) return;
    renderGroups(panelRefs.groupsEl, panelRefs.search.value);
}

function mountPanel(host) {
    clear(host);
    const help = el(
        "p.blocks-help",
        "Type ",
        el("code", ";trigger"),
        " in a cell and press ",
        el("kbd", "Tab"),
        " to expand it. Hold ",
        el("kbd", "Shift"),
        " while pressing ",
        el("kbd", "Tab"),
        " to expand a multi-line block as separate rows instead of one cell. ",
        el("kbd", `${MOD_LABEL}+Shift+B`),
        " opens the quick picker from anywhere on the grid.",
    );
    const search = el("input.blocks-search", { type: "search", placeholder: "Search blocks (trigger, title, tag)" });
    const actions = el(
        "div.blocks-actions",
        el("button", { type: "button", onClick: () => openBlockEditor(null) }, "+ New block"),
        el("button", { type: "button", onClick: exportLibrary }, "Export JSON"),
        el("button", { type: "button", onClick: importLibraryPrompt }, "Import JSON"),
    );
    const groupsEl = el("div.blocks-groups");
    host.append(help, search, actions, groupsEl);
    search.addEventListener("input", debounce(() => renderGroups(groupsEl, search.value), 120));
    panelRefs = { search, groupsEl };
    renderGroups(groupsEl, "");
}

// --- Starter blocks (seeded once) ------------------------------------------------

// Genuinely useful shells a debater would actually paste onto a flow — short,
// tag-shaped lines, not paragraphs. Seeded once; every field is editable
// afterward and each carries the "starter" tag so the panel marks it as an
// example rather than something sacred.
const STARTER_BLOCKS = [
    {
        trigger: "perm",
        title: "Perm — do both",
        event: "policy",
        tags: ["perm", "theory"],
        body: "Perm: do both\nNot severance — reads the aff and the alt together\nSolves the net benefit\nAff still key to test the alt",
    },
    {
        trigger: "perm-seq",
        title: "Perm — do the aff, then the alt",
        event: "policy",
        tags: ["perm", "theory"],
        body: "Perm: do the aff, then the alt\nSequencing solves their link\nNo reason the alt can't happen after the plan",
    },
    {
        trigger: "condo-bad",
        title: "Condo bad",
        event: "policy",
        tags: ["theory", "condo"],
        body: "Condo bad — reject the team\nA) Moving target — kills 2AC strategy\nB) Time skew — forces aff to cover everything\nC) No real-world corollary — no actor kicks out of advocacy\nVoters: fairness, education",
    },
    {
        trigger: "condo-good",
        title: "Condo good",
        event: "policy",
        tags: ["theory", "condo"],
        body: "Condo good — reject the argument only\nA) Tests aff flexibility — key to neg ground\nB) Real-world — policymakers test multiple options\nC) Reciprocity — aff gets perms, we get conditionality\nNo in-round abuse — don't drop the debater for it",
    },
    {
        trigger: "t-fw",
        title: "T — framework shell",
        event: "policy",
        tags: ["theory", "T"],
        body: "Interpretation: \nViolation: the aff \nStandards:\n- Limits\n- Ground\n- Predictability\nVoters: fairness, education — drop the debater",
    },
    {
        trigger: "theory",
        title: "Standard theory shell",
        event: "any",
        tags: ["theory"],
        body: "Interpretation: \nViolation: \nStandards:\n1) \n2) \nVoters: fairness / education — drop the debater, reciprocity",
    },
    {
        trigger: "extend",
        title: "Extend the card",
        event: "any",
        tags: ["extension"],
        body: "Extend [card] — never answered\nWarrant: \nImpact: \nCross-apply to [flow]",
    },
    {
        trigger: "dropped",
        title: "They dropped X",
        event: "any",
        tags: ["dropped"],
        body: "They dropped [argument] — extend it clean\nThis alone resolves [the flow / the debate]\nNew answers here are new args — no new 2N/2A",
    },
    {
        trigger: "impact-calc",
        title: "Impact calc",
        event: "any",
        tags: ["weighing"],
        body: "Weigh: magnitude, probability, timeframe\nOur impact outweighs on [X]\nEven if they win their impact, ours comes first / is bigger\nTurns case: [warrant]",
    },
    {
        trigger: "presumption",
        title: "Presumption / permissibility",
        event: "ld",
        tags: ["framework"],
        body: "Presumption negates — status quo is the default\nAbsent offense, vote neg\nPermissibility: if neither side wins offense, err neg — action requires justification",
    },
    {
        trigger: "util",
        title: "Util framing",
        event: "ld",
        tags: ["framework"],
        body: "Util is the only viable framework\nA) Action-guiding — other frameworks moralize, don't decide\nB) Predictable — every actor can weigh consequences\nC) Avoids moral absolutism — some harms must be weighed",
    },
    {
        trigger: "turns",
        title: "Turns the case",
        event: "any",
        tags: ["weighing"],
        body: "This turns the case — [warrant]\nEven on their framework this outweighs\nPrioritize turns — they access both sides of the ballot",
    },
    {
        trigger: "pf-weigh",
        title: "PF weighing — framework of the round",
        event: "pf",
        tags: ["pf", "weighing"],
        body: "Weighing mechanism: [magnitude / probability / timeframe]\nOur case accesses this first\nEven if they win [X], we outweigh on [Y]",
    },
    {
        trigger: "framework",
        title: "Framework — role of the ballot",
        event: "any",
        tags: ["framework"],
        body: "Role of the ballot: vote for the team that better [X]\nOur framework comes first — precondition to weighing impacts\nEven under their framework, we win",
    },
    {
        trigger: "cx",
        title: "CX — cross-apply answer",
        event: "any",
        tags: ["cx"],
        body: "Cross-apply my [X] argument from [flow]\nThey conceded this in cross — extend it\nThis pre-empts their [Y] argument",
    },
];

/** Seed the starter blocks into the shared library, once, ever. */
function seedStarterBlocks() {
    if (localStorage.getItem(LS_SEEDED_KEY)) return;
    const now = Date.now();
    const starters = STARTER_BLOCKS.map((s) =>
        normalizeBlock({
            id: uid("block"),
            trigger: s.trigger,
            title: s.title,
            body: s.body,
            tags: [...s.tags, "starter"],
            event: s.event,
            uses: 0,
            updatedAt: now,
        }),
    );
    libraryCache = [...libraryCache, ...starters];
    saveLibrary(libraryCache);
    try {
        localStorage.setItem(LS_SEEDED_KEY, "1");
    } catch {
        // Best effort — if even this tiny flag can't be written, storage is in
        // a bad state and saveLibrary() above already surfaced that.
    }
}

// --- Commands, toolbar, panel registration, init -----------------------------------

function registerCommands() {
    register({
        id: "blocks.picker",
        title: "Block picker (fuzzy search & insert)",
        category: "Blocks",
        icon: "▦",
        keys: ["Mod+Shift+B"],
        run: () => openPicker(),
    });
    register({
        id: "blocks.openPanel",
        title: "Open block library panel",
        category: "Blocks",
        run: () => ui.togglePanel("blocks"),
    });
    register({
        id: "blocks.newBlock",
        title: "New block…",
        category: "Blocks",
        run: () => openBlockEditor(null),
    });
    register({
        id: "blocks.export",
        title: "Export block library (JSON)",
        category: "Blocks",
        run: () => exportLibrary(),
    });
    register({
        id: "blocks.import",
        title: "Import block library (JSON)",
        category: "Blocks",
        run: () => importLibraryPrompt(),
    });
}

function registerToolbar() {
    ui.addToolbarButton({
        id: "blocks",
        label: "Blocks",
        icon: "▦",
        title: `Block library (${MOD_LABEL}+Shift+B to insert)`,
        slot: "right",
        onClick: () => ui.togglePanel("blocks"),
    });
}

function registerDockPanel() {
    ui.registerPanel({
        id: "blocks",
        title: "Blocks",
        icon: "▦",
        order: 40,
        mount: (host) => mountPanel(host),
        onShow: () => renderPanel(),
    });
}

/** Boot the block library: load storage, seed starters, wire everything up. */
export function init() {
    libraryCache = loadLibrary();
    seedStarterBlocks();
    registerCommands();
    registerToolbar();
    registerDockPanel();
    bindGridHost();
    // Round blocks (and undo/redo) can change the round without going through
    // our own CRUD helpers above — keep the open panel honest.
    bus.on("round:change", debounce(() => renderPanel(), 150));
}

export const blocks = {
    /** Every block, both scopes, badged with `.scope`. */
    all: allBlocks,
    /** Ranked blocks matching a fuzzy query. */
    find,
    /** Insert a block by id at the current cursor (no new row). */
    insert(id) {
        const b = allBlocks().find((x) => x.id === id);
        if (!b) return false;
        insertBlock(b, { newRow: false });
        return true;
    },
};

export default blocks;
