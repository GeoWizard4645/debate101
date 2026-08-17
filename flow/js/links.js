/**
 * Cascade — FEATURE 2: Answer Links & Dropped-Argument Radar.
 *
 * The flow grid alone answers "what was said." This module answers "what got
 * answered" — the question a debater actually needs mid-round. It adds three
 * things on top of the grid:
 *
 *   1. Explicit links: a debater can point one cell at the cell it answers
 *      (`Mod+L`), which matters when the answer isn't in the very next column
 *      (a cross-apply from another sheet, or an answer two speeches later).
 *      Links are drawn as curves over the grid and mirrored into ebb's own
 *      `meta.answers` field so a flow opened in plain ebb still shows them.
 *   2. The dropped-argument radar: anything argued that got neither a same-row
 *      answer in the next column nor an explicit link is flagged, because a
 *      debater who can read off "they dropped X, Y, Z" in a rebuttal is a
 *      debater who wins more rounds than one who has to re-scan the flow live.
 *   3. The extension chain view: one argument's row, read left to right, so a
 *      debater can see exactly where in the round it died.
 *
 * Link direction convention: `from` is the cell selected when `Mod+L` starts
 * the link (the argument), `to` is the cell that completes it (the answer).
 * `meta.answers` is mirrored onto `to` — ebb's field already means "the cell
 * this one answers," so `to.meta.answers` points back at `from`. Dropped
 * detection treats a cell as "linked" if it appears as *either* endpoint of
 * any link, so it never depends on a debater remembering which end they
 * clicked first.
 */

import { on, emit } from "./bus.js";
import { el, $, clear, debounce } from "./dom.js";
import { register } from "./registry.js";
import {
    uid,
    sheetById,
    sortedSheets,
    sheetColumns,
    getCell,
    getMeta,
    setMeta,
    cellKey,
    ensureCascade,
    happenedColumns,
} from "./model.js";
import { store } from "./store.js";
import { ui } from "./ui.js";

const KINDS = ["answers", "extends", "turns", "crossapplies"];
const PANEL_ID = "links";
const SVG_NS = "http://www.w3.org/2000/svg";

// --- module state --------------------------------------------------------

let initialized = false;

/** The in-progress link, or null when not linking. */
let linkState = null; // { from: {sheetId,row,col}, sourceEl: HTMLElement|null }

/** Overridable cell lookup — grid.js's real DOM structure may differ from the
 * `[data-row][data-col]` guess below; `links.setCellLocator()` lets
 * integration hand us the real thing without touching this file again. */
let cellLocator = defaultCellLocator;

let overlayHidden = false;
let liveSpeech = null; // last `timer:speech` payload: {speechId, side, running}
let lastSelection = null; // last `grid:selection` payload
let lastDropped = []; // most recent findDropped() result
let sideFilter = "all"; // "all" | "aff" | "neg", dropped-list filter

/** @type {{chainHost: HTMLElement, filterRow: HTMLElement, listHost: HTMLElement} | null} */
let panelRefs = null;

/** Cells we've added cg-* classes to, so the next decorate pass can clear
 * exactly what it set without guessing at grid.js's own classes. */
let decoratedEls = new Set();

// --- pure: dropped-argument detection -------------------------------------

/**
 * Every argument that looks dropped: it has text, the next speech column on
 * its sheet is empty in that row, nothing links it to an answer elsewhere,
 * it isn't marked kicked, and the next speech has actually happened.
 *
 * Pure and DOM-free on purpose — the radar's correctness is the headline
 * feature here, and a function that only reads its arguments is the only
 * kind you can unit-test without booting the whole app.
 *
 * @param {import("./model.js").FlowRound} round
 * @param {{liveSpeechId?: string|null}} [ctx]
 *   `liveSpeechId` is the bus's current `timer:speech` payload, threaded in
 *   by the caller rather than read here so this stays a pure function of
 *   its arguments (bus state is a live-module concern, not this function's).
 * @returns {Array<{sheetId:string, sheetTitle:string, row:number, col:number,
 *   speech:string, side:"aff"|"neg", text:string, severity:number}>}
 */
export function findDropped(round, { liveSpeechId = null } = {}) {
    const out = [];
    if (!round || !Array.isArray(round.sheets)) return out;

    const links = round.cascade?.links ?? [];

    for (const sheet of round.sheets) {
        if (sheet.kind === "cx") continue; // cross-ex periods aren't an answer sequence
        const columns = sheetColumns(round, sheet);
        if (columns.length < 2) continue; // nothing to be dropped from a one-column sheet
        const rows = sheet.data ?? [];

        // "Has that speech happened yet?" is model.js's answer, not this
        // module's — analytics asks the same question and the two must agree.
        const hasHappened = happenedColumns(round, sheet, columns, { liveSpeechId });

        for (let row = 0; row < rows.length; row++) {
            for (let col = 0; col < columns.length - 1; col++) {
                const text = getCell(sheet, row, col);
                if (!text.trim()) continue; // nothing argued here

                const meta = getMeta(sheet, row, col);
                if (meta?.kicked) continue; // dead on purpose, not dropped

                const nextText = getCell(sheet, row, col + 1);
                if (nextText.trim()) continue; // answered right in the next column

                const isLinked = links.some(
                    (l) =>
                        (l.from?.sheetId === sheet.id && l.from?.row === row && l.from?.col === col) ||
                        (l.to?.sheetId === sheet.id && l.to?.row === row && l.to?.col === col),
                );
                if (isLinked) continue; // tracked via an explicit link elsewhere

                if (!hasHappened(col + 1)) continue; // their next speech hasn't come yet

                const cascadeMeta = meta?.cascade ?? {};
                // Earlier speeches and marked cards/stars matter more in a
                // rebuttal, so they should sort to the top of the radar.
                let severity = (columns.length - col) * 10;
                if (meta?.card) severity += 5;
                if (cascadeMeta.star) severity += 5;

                out.push({
                    sheetId: sheet.id,
                    sheetTitle: sheet.title,
                    row,
                    col,
                    speech: columns[col].short || columns[col].name || columns[col].id,
                    side: columns[col].side,
                    text: text.trim(),
                    severity,
                });
            }
        }
    }

    out.sort((a, b) => b.severity - a.severity);
    return out;
}

// --- cell lookup -----------------------------------------------------------

/** Best-effort cell element lookup. grid.js only renders the active sheet, so
 * a link whose sheet isn't on screen has no element to find — that's the
 * "skip links on another sheet" rule from the spec, enforced right here. */
function defaultCellLocator(sheetId, row, col) {
    if (sheetId !== store.activeSheetId) return null;
    const host = $("#grid-host");
    if (!host) return null;
    return host.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

/** Never let a bad locator (ours or a caller's replacement) crash a redraw. */
function safeLocate(sheetId, row, col) {
    try {
        return cellLocator(sheetId, row, col) ?? null;
    } catch (err) {
        console.error("[links] cell locator threw:", err);
        return null;
    }
}

// --- linking state machine --------------------------------------------------

function statusHintNode() {
    return el(
        "span.cl-status-hint",
        null,
        "Linking… click a cell (or ",
        el("kbd", { text: "Mod+L" }),
        " again) to complete, ",
        el("kbd", { text: "Esc" }),
        " to cancel",
    );
}

function beginLink(sheetId, row, col) {
    endLinking(); // defensive: clears any stale outline before starting a new one
    const sourceEl = safeLocate(sheetId, row, col);
    sourceEl?.classList.add("cl-linking-source");
    linkState = { from: { sheetId, row, col }, sourceEl };
    ui.setStatus("cl-linking", statusHintNode());
}

function endLinking() {
    if (!linkState) return;
    linkState.sourceEl?.classList.remove("cl-linking-source");
    linkState = null;
    ui.clearStatus("cl-linking");
}

function cancelLinking() {
    if (!linkState) return;
    endLinking();
    ui.toast("Link cancelled", { type: "info", ms: 1400 });
}

function completeLink(sheetId, row, col) {
    if (!linkState) return;
    const from = linkState.from;
    if (from.sheetId === sheetId && from.row === row && from.col === col) {
        ui.toast("Pick a different cell to link to", { type: "warn", ms: 2000 });
        return;
    }
    const to = { sheetId, row, col };
    const link = { id: uid("link"), from, to, kind: "answers", note: "" };

    store.commit(
        (round) => {
            const cascade = ensureCascade(round);
            cascade.links.push(link);
            const toSheet = sheetById(round, to.sheetId);
            if (toSheet) setMeta(toSheet, to.row, to.col, { answers: { ...from } });
        },
        { label: "Link answer" },
    );

    endLinking();
    ui.toast("Linked", { type: "success", ms: 1200 });
}

function findLinkAt(sheetId, row, col) {
    return store.cascade.links.find(
        (l) =>
            (l.from.sheetId === sheetId && l.from.row === row && l.from.col === col) ||
            (l.to.sheetId === sheetId && l.to.row === row && l.to.col === col),
    );
}

function cycleLinkKind() {
    const sheetId = store.activeSheetId;
    const sel = store.selection;
    if (!sheetId || !sel) return;
    const link = findLinkAt(sheetId, sel.row, sel.col);
    if (!link) {
        ui.toast("No link on this cell", { type: "info", ms: 1600 });
        return;
    }
    const next = KINDS[(KINDS.indexOf(link.kind) + 1) % KINDS.length];
    store.commit(
        (round) => {
            const cascade = ensureCascade(round);
            const l = cascade.links.find((x) => x.id === link.id);
            if (l) l.kind = next;
        },
        { label: "Change link kind", coalesce: `link-kind-${link.id}` },
    );
}

// --- pruning dangling links ------------------------------------------------

function endpointValid(round, ep) {
    const sheet = sheetById(round, ep?.sheetId);
    if (!sheet || !Array.isArray(sheet.data)) return false;
    return Number.isInteger(ep.row) && ep.row >= 0 && ep.row < sheet.data.length && Number.isInteger(ep.col) && ep.col >= 0;
}

/**
 * Drop links whose endpoints no longer exist (their row was deleted, or the
 * sheet itself was). Reads first so a clean round never issues a no-op
 * commit — that matters because this runs off `round:change`, and a commit
 * inside a `round:change` handler that always fires would loop forever.
 */
function pruneDanglingLinks() {
    const round = store.round;
    const current = store.cascade.links;
    const stillValid = current.filter((l) => endpointValid(round, l.from) && endpointValid(round, l.to));
    if (stillValid.length === current.length) return; // nothing to prune

    store.commit(
        (draft) => {
            const cascade = ensureCascade(draft);
            cascade.links = cascade.links.filter((l) => endpointValid(draft, l.from) && endpointValid(draft, l.to));
        },
        { label: "Prune dangling links", silent: true, coalesce: "links-prune" },
    );
}

// --- SVG overlay -------------------------------------------------------------

function markerDefs() {
    const kindDefs = KINDS.map(
        (kind) => `
        <marker id="cl-arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--cl-${kind})"></path>
        </marker>`,
    ).join("");
    return `<defs>${kindDefs}</defs>`;
}

/** Creates (or re-creates, if grid.js wiped `#grid-host`'s children) the
 * overlay svg. Always safe to call — returns null only when there is
 * nowhere to mount it yet. */
function ensureOverlay() {
    const host = $("#grid-host");
    if (!host) return null;
    let svg = $("#cl-overlay", host);
    if (svg) return svg;

    // The overlay tracks cells by absolute position, so the host needs to be
    // a positioning context; grid.js's own layout is not this file's to
    // change, so this only steps in when the host is still `position: static`.
    if (getComputedStyle(host).position === "static") host.style.position = "relative";

    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "cl-overlay");
    svg.setAttribute("class", "cl-overlay");
    svg.innerHTML = markerDefs(); // static, no user text — safe
    host.appendChild(svg);
    return svg;
}

function rectOffscreen(rect, hostRect) {
    return rect.right < hostRect.left || rect.left > hostRect.right || rect.bottom < hostRect.top || rect.top > hostRect.bottom;
}

function redrawOverlay() {
    const svg = ensureOverlay();
    if (!svg) return;

    // Clear previously drawn paths, keeping the <defs> markers.
    for (const node of [...svg.querySelectorAll("path.cl-link")]) node.remove();
    svg.classList.toggle("cl-hidden", overlayHidden);
    if (overlayHidden) return;

    const host = $("#grid-host");
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const activeSheetId = store.activeSheetId;

    for (const link of store.cascade.links) {
        // Both endpoints must be on the sheet currently rendered — the other
        // sheet's cells simply have no DOM element to draw between.
        if (link.from.sheetId !== activeSheetId || link.to.sheetId !== activeSheetId) continue;

        const fromEl = safeLocate(link.from.sheetId, link.from.row, link.from.col);
        const toEl = safeLocate(link.to.sheetId, link.to.row, link.to.col);
        if (!fromEl || !toEl) continue;

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        if (rectOffscreen(fromRect, hostRect) || rectOffscreen(toRect, hostRect)) continue;

        const x1 = fromRect.right - hostRect.left;
        const y1 = fromRect.top + fromRect.height / 2 - hostRect.top;
        const x2 = toRect.left - hostRect.left;
        const y2 = toRect.top + toRect.height / 2 - hostRect.top;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2 - 22; // a gentle upward arc so overlapping links are legible

        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`);
        path.setAttribute("class", `cl-link cl-link-${link.kind}`);
        path.setAttribute("marker-end", `url(#cl-arrow-${link.kind})`);
        svg.appendChild(path);
    }
}

const scheduleRedraw = debounce(redrawOverlay, 16);

function toggleOverlay() {
    overlayHidden = !overlayHidden;
    ui.setToolbarButtonState(PANEL_ID + ".toggleOverlay", { active: !overlayHidden });
    redrawOverlay();
}

// --- cell decoration ---------------------------------------------------------

/** Adds `cg-dropped` / `cg-link-source` / `cg-link-target` directly to cell
 * elements (best-effort — grid.js may not have rendered a given cell) and
 * also emits `links:decorate` with the same information as plain keys, so
 * grid.js can apply its own styling without querying the DOM itself. */
function decorate(dropped, links) {
    for (const cellEl of decoratedEls) cellEl.classList.remove("cg-dropped", "cg-link-source", "cg-link-target");
    decoratedEls = new Set();

    const droppedKeys = [];
    for (const d of dropped) {
        droppedKeys.push(`${d.sheetId}:${cellKey(d.row, d.col)}`);
        const cellEl = safeLocate(d.sheetId, d.row, d.col);
        if (cellEl) {
            cellEl.classList.add("cg-dropped");
            decoratedEls.add(cellEl);
        }
    }

    const sourceKeys = [];
    const targetKeys = [];
    for (const link of links) {
        sourceKeys.push(`${link.from.sheetId}:${cellKey(link.from.row, link.from.col)}`);
        targetKeys.push(`${link.to.sheetId}:${cellKey(link.to.row, link.to.col)}`);
        const fromEl = safeLocate(link.from.sheetId, link.from.row, link.from.col);
        if (fromEl) {
            fromEl.classList.add("cg-link-source");
            decoratedEls.add(fromEl);
        }
        const toEl = safeLocate(link.to.sheetId, link.to.row, link.to.col);
        if (toEl) {
            toEl.classList.add("cg-link-target");
            decoratedEls.add(toEl);
        }
    }

    emit("links:decorate", { dropped: droppedKeys, linkSources: sourceKeys, linkTargets: targetKeys });
}

// --- dropped list / badge / panel --------------------------------------------

function computeDropped() {
    // Only a *running* clock counts as a live speech. timers.js arms the next
    // speech the moment a round opens, and treating that as live told the radar
    // the round was under way — which switched off the flowed-columns fallback
    // and reported nothing dropped on every flow typed up after the round.
    const live = liveSpeech?.running ? liveSpeech.speechId : null;
    return findDropped(store.round, { liveSpeechId: live });
}

function refreshDropped() {
    lastDropped = computeDropped();
    ui.setPanelBadge(PANEL_ID, lastDropped.length || null);
    renderDroppedList();
    decorate(lastDropped, store.cascade.links);
}

function truncate(text, n) {
    const t = String(text ?? "");
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function formatDroppedList(dropped) {
    if (!dropped.length) return "Nothing dropped — everything on the flow got an answer.";
    const lines = ["They dropped:"];
    for (const d of dropped) lines.push(`- [${d.speech}] ${d.sheetTitle}: ${d.text}`);
    return lines.join("\n");
}

async function copyDroppedList() {
    const filtered = sideFilter === "all" ? lastDropped : lastDropped.filter((d) => d.side === sideFilter);
    const text = formatDroppedList(filtered);
    try {
        await navigator.clipboard.writeText(text);
        ui.toast("Copied dropped-argument list", { type: "success", ms: 1600 });
    } catch {
        // Clipboard permission denied or unavailable — fall back to a
        // select-and-copy-by-hand dialog rather than silently failing.
        await ui.modal({
            title: "Dropped arguments",
            body: el("textarea.cl-copy-fallback", { readonly: true, text }),
            actions: [{ id: "close", label: "Close", primary: true }],
            onMount: (dialog) => dialog.querySelector("textarea")?.select(),
        });
    }
}

function renderFilterRow() {
    if (!panelRefs) return;
    const { filterRow } = panelRefs;
    clear(filterRow);
    for (const [value, label] of [["all", "All"], ["aff", "Aff"], ["neg", "Neg"]]) {
        filterRow.append(
            el(`button.cl-filter-btn${value === sideFilter ? ".cl-active" : ""}`, {
                type: "button",
                text: label,
                onClick: () => {
                    sideFilter = value;
                    renderFilterRow();
                    renderDroppedList();
                },
            }),
        );
    }
    filterRow.append(el("button.cl-copy-btn", { type: "button", text: "Copy as list", onClick: () => copyDroppedList() }));
}

function renderDroppedList() {
    if (!panelRefs) return;
    const { listHost } = panelRefs;
    clear(listHost);
    const filtered = sideFilter === "all" ? lastDropped : lastDropped.filter((d) => d.side === sideFilter);
    if (!filtered.length) {
        listHost.append(el("div.cl-empty", { text: "Nothing dropped." }));
        return;
    }

    const bySheet = new Map();
    for (const d of filtered) {
        if (!bySheet.has(d.sheetId)) bySheet.set(d.sheetId, { title: d.sheetTitle, items: [] });
        bySheet.get(d.sheetId).items.push(d);
    }
    for (const group of bySheet.values()) {
        listHost.append(el("div.cl-group-title", { text: group.title }));
        for (const d of group.items) {
            listHost.append(
                el(
                    "button.cl-row",
                    {
                        type: "button",
                        title: d.text,
                        onClick: () => emit("grid:goto", { sheetId: d.sheetId, row: d.row, col: d.col }),
                    },
                    el("span.cl-row-speech", { text: d.speech }),
                    el("span.cl-row-text", { text: truncate(d.text, 80) }),
                ),
            );
        }
    }
}

// --- extension chain view -----------------------------------------------------

function buildChain(sheetId, row) {
    const round = store.round;
    const sheet = sheetById(round, sheetId);
    if (!sheet) return null;
    const columns = sheetColumns(round, sheet);
    let diedAt = -1;
    let sawContent = false;
    const cells = columns.map((column, idx) => {
        const text = getCell(sheet, row, idx);
        const meta = getMeta(sheet, row, idx);
        const has = text.trim().length > 0;
        if (has) sawContent = true;
        else if (sawContent && diedAt === -1) diedAt = idx;
        return { idx, speech: column.short || column.name || column.id, text, kicked: !!meta?.kicked, empty: !has };
    });
    return { sheetTitle: sheet.title, cells, diedAt };
}

function renderChain(selection) {
    if (!panelRefs) return;
    const { chainHost } = panelRefs;
    clear(chainHost);
    if (!selection) {
        chainHost.append(el("div.cl-empty", { text: "Select a cell to see its chain." }));
        return;
    }
    const chain = buildChain(selection.sheetId, selection.row);
    if (!chain) {
        chainHost.append(el("div.cl-empty", { text: "—" }));
        return;
    }
    const row = el("div.cl-chain-row");
    for (const c of chain.cells) {
        const classes = ["cl-chain-cell"];
        if (c.kicked) classes.push("cl-chain-kicked");
        if (c.empty) classes.push("cl-chain-empty");
        if (chain.diedAt === c.idx) classes.push("cl-chain-died");
        row.append(
            el(
                `div.${classes.join(".")}`,
                { title: c.text },
                el("span.cl-chain-speech", { text: c.speech }),
                el("span.cl-chain-text", { text: c.empty ? "—" : truncate(c.text, 40) }),
            ),
        );
    }
    chainHost.append(row);
}

// --- panel mount ---------------------------------------------------------------

function mountPanel(root) {
    const chainHost = el("div.cl-chain");
    const filterRow = el("div.cl-filter-row");
    const listHost = el("div.cl-list");
    root.append(
        el(
            "div.cl-panel",
            null,
            el("div.cl-section-title", { text: "Extension chain" }),
            chainHost,
            el("div.cl-section-title", { text: "Dropped arguments" }),
            filterRow,
            listHost,
        ),
    );
    panelRefs = { chainHost, filterRow, listHost };
    renderFilterRow();
    renderChain(lastSelection);
    renderDroppedList();
}

// --- next dropped -------------------------------------------------------------

function jumpToNextDropped() {
    const round = store.round;
    const dropped = computeDropped();
    if (!dropped.length) {
        ui.toast("Nothing dropped right now", { type: "success", ms: 1600 });
        return;
    }
    const order = sortedSheets(round).map((s) => s.id);
    const rank = (d) => [order.indexOf(d.sheetId), d.row, d.col];
    const ordered = [...dropped].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });

    const sel = store.selection ?? {};
    const cur = [order.indexOf(store.activeSheetId), sel.row ?? -1, sel.col ?? -1];
    const next =
        ordered.find((d) => {
            const r = rank(d);
            return r[0] > cur[0] || (r[0] === cur[0] && (r[1] > cur[1] || (r[1] === cur[1] && r[2] > cur[2])));
        }) ?? ordered[0]; // wrap around

    emit("grid:goto", { sheetId: next.sheetId, row: next.row, col: next.col });
}

// --- CSS (structural only; cg-* look-and-feel belongs to grid.js/app.css) -----

function injectStyles() {
    if ($("#cl-styles")) return;
    const style = el("style", { id: "cl-styles" });
    style.textContent = `
        :root {
            --cl-answers: var(--d1-accent-2, #38bdf8);
            --cl-extends: var(--card, #fbbf24);
            --cl-turns: var(--neg, #f43f5e);
            --cl-crossapplies: var(--aff, #10b981);
        }
        .cl-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 6; overflow: visible; }
        .cl-overlay.cl-hidden { display: none; }
        .cl-link { fill: none; stroke-width: 2; opacity: 0.85; }
        .cl-link-answers { stroke: var(--cl-answers); }
        .cl-link-extends { stroke: var(--cl-extends); }
        .cl-link-turns { stroke: var(--cl-turns); }
        .cl-link-crossapplies { stroke: var(--cl-crossapplies); }
        .cl-linking-source { outline: 2px dashed var(--cl-answers); outline-offset: -2px; }
        .cl-status-hint kbd { font: inherit; padding: 0 4px; border-radius: 3px; border: 1px solid currentColor; opacity: 0.8; }
        .cl-panel { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.6rem; }
        .cl-section-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.65; margin-top: 0.4rem; }
        .cl-chain-row { display: flex; flex-wrap: wrap; gap: 0.25rem; }
        .cl-chain-cell { border: 1px solid rgba(128,128,128,0.3); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; display: flex; flex-direction: column; min-width: 3.5rem; max-width: 8rem; }
        .cl-chain-empty { opacity: 0.45; }
        .cl-chain-kicked { text-decoration: line-through; opacity: 0.5; }
        .cl-chain-died { border-color: var(--cl-turns); }
        .cl-chain-speech { font-weight: 600; font-size: 0.62rem; opacity: 0.7; }
        .cl-chain-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cl-filter-row { display: flex; gap: 0.25rem; align-items: center; }
        .cl-filter-btn { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(128,128,128,0.35); background: transparent; cursor: pointer; }
        .cl-filter-btn.cl-active { background: var(--d1-accent, #0072b1); color: #fff; border-color: transparent; }
        .cl-copy-btn { margin-left: auto; font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
        .cl-list { display: flex; flex-direction: column; gap: 0.2rem; overflow-y: auto; }
        .cl-group-title { font-size: 0.7rem; font-weight: 600; opacity: 0.7; margin-top: 0.3rem; }
        .cl-row { display: flex; gap: 0.5rem; text-align: left; padding: 3px 6px; border-radius: 4px; border: none; background: transparent; cursor: pointer; width: 100%; }
        .cl-row:hover { background: rgba(128,128,128,0.12); }
        .cl-row-speech { font-weight: 600; font-size: 0.7rem; opacity: 0.8; min-width: 2.4rem; }
        .cl-row-text { font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cl-empty { opacity: 0.5; font-size: 0.78rem; padding: 0.4rem 0; }
        .cl-copy-fallback { width: 100%; min-height: 8rem; }
    `;
    document.head.append(style);
}

// --- commands / toolbar / panel registration -----------------------------------

function registerCommands() {
    register({
        id: "links.startOrCompleteLink",
        title: "Start / complete answer link",
        category: "Links",
        icon: "\u{1F517}",
        keys: ["Mod+L"],
        run: () => {
            const sheetId = store.activeSheetId;
            const sel = store.selection;
            if (!sheetId || !sel) return;
            if (!linkState) beginLink(sheetId, sel.row, sel.col);
            else completeLink(sheetId, sel.row, sel.col);
        },
    });

    register({
        id: "links.cycleKind",
        title: "Cycle link kind on selected cell",
        category: "Links",
        icon: "↻",
        keys: ["Mod+Shift+L"],
        run: cycleLinkKind,
    });

    register({
        id: "links.nextDropped",
        title: "Jump to next dropped argument",
        category: "Links",
        icon: "→",
        keys: ["Mod+Shift+D"],
        run: jumpToNextDropped,
    });

    register({
        id: `${PANEL_ID}.toggleOverlay`,
        title: "Toggle answer-link overlay",
        category: "Links",
        icon: "\u{1F517}",
        run: toggleOverlay,
    });
}

function registerPanelAndToolbar() {
    ui.registerPanel({ id: PANEL_ID, title: "Links & Drops", icon: "\u{1F517}", order: 20, mount: mountPanel });
    ui.addToolbarButton({
        id: `${PANEL_ID}.toggleOverlay`,
        icon: "\u{1F517}",
        title: "Toggle answer-link overlay",
        slot: "right",
        active: true,
        onClick: toggleOverlay,
    });
}

// --- DOM / bus wiring ------------------------------------------------------------

function attachDomListeners() {
    // Completes a link on a genuine pointer click, per spec — arrow-key
    // selection changes must NOT complete a link on their own, only a click
    // (handled here) or a second Mod+L (handled in the command above).
    document.addEventListener("click", (e) => {
        if (!linkState) return;
        const cellEl = e.target?.closest?.("#grid-host [data-row][data-col]");
        if (!cellEl) return;
        const row = Number(cellEl.dataset.row);
        const col = Number(cellEl.dataset.col);
        if (!Number.isInteger(row) || !Number.isInteger(col)) return;
        completeLink(store.activeSheetId, row, col);
    });

    document.addEventListener("keydown", (e) => {
        if (!linkState) return;
        if (e.key === "Escape") {
            e.preventDefault();
            cancelLinking();
        }
    });

    const host = $("#grid-host");
    if (host) {
        // capture:true so this still fires if grid.js's own scroller is a
        // descendant of #grid-host rather than the host element itself —
        // scroll doesn't bubble, but the capture phase reaches it regardless.
        host.addEventListener("scroll", scheduleRedraw, true);
        if (typeof ResizeObserver === "function") {
            new ResizeObserver(scheduleRedraw).observe(host);
        }
    }
    window.addEventListener("resize", scheduleRedraw);
}

const onRoundChange = debounce(() => {
    pruneDanglingLinks();
    refreshDropped();
    scheduleRedraw();
}, 200);

function attachBusListeners() {
    on("round:change", onRoundChange);
    on("sheet:change", () => {
        scheduleRedraw();
        refreshDropped();
    });
    on("grid:selection", (payload) => {
        lastSelection = payload;
        renderChain(payload);
        scheduleRedraw();
    });
    on("timer:speech", (payload) => {
        liveSpeech = payload ?? null;
        refreshDropped();
    });
}

// --- public surface ----------------------------------------------------------

/** Boots the feature: commands, panel, toolbar button, and listeners. Safe to
 * call once; main.js calls this after the shell and store exist. */
export function init() {
    if (initialized) return;
    initialized = true;
    injectStyles();
    registerCommands();
    registerPanelAndToolbar();
    attachDomListeners();
    attachBusListeners();
    refreshDropped();
    scheduleRedraw();
}

export const links = {
    /** Hand this module a better cell-element lookup than the
     * `[data-row][data-col]` guess it starts with. `fn(sheetId, row, col)`
     * should return an element or a falsy value.
     * @param {(sheetId: string, row: number, col: number) => (Element|null|undefined)} fn */
    setCellLocator(fn) {
        cellLocator = typeof fn === "function" ? fn : defaultCellLocator;
        scheduleRedraw();
    },
    toggleOverlay,
    nextDropped: jumpToNextDropped,
    findDropped,
};

export default links;
