/**
 * Cascade — the flow grid.
 *
 * A sheet is a grid: rows are arguments, columns are speeches. Everything else
 * in the app exists to serve the twenty minutes a debater spends inside this
 * one component, so it is written for the hands rather than the mouse — Tab
 * answers the argument you are on, Mod+Enter starts a new one under it, and
 * nothing between a keystroke and the character appearing goes through a
 * framework.
 *
 * Rendering is a real <table> in a windowed scroller. Rows are measured rather
 * than assumed: a flow cell holds a tag, a warrant, and sometimes a card, so a
 * fixed row height would either clip arguments or waste half the screen. The
 * height cache below is what lets the window math stay honest about rows it has
 * actually drawn while still guessing cheaply about the ones it has not.
 *
 * ## CSS classes this module emits
 * Owned by app.css:  .flow-grid, th/td .col-aff, .col-neg, .col-live,
 *   td.is-selected, .cell-bold, .cell-highlight, .cell-card, .cell-group,
 *   .cell-kicked, .cell-star, .cell-flagged, .cell-answered, .cell-voter,
 *   .cell-color-{amber,rose,sky,lime,violet}, .grid-empty
 * Owned here (structural only, injected below): .cg-wrap, .cg-rowhead,
 *   .cg-editor, .cg-find, .cg-spacer, .cg-match, .cg-match-active
 * Written by links.js onto cells this module renders: .cg-dropped,
 *   .cg-link-source, .cg-link-target — styled here so they land somewhere.
 *
 * Every cell carries data-row / data-col inside #grid-host; links.js locates
 * cells by exactly that selector, so those attributes are load-bearing API.
 */

import bus from "./bus.js";
import { $, clear, debounce, el } from "./dom.js";
import { getCell, getMeta, sheetColumns, setCell, setMeta } from "./model.js";
import registry from "./registry.js";
import store from "./store.js";

/** Estimated height for a row nothing has measured yet. */
const ROW_ESTIMATE = 26;
/** Rows rendered above and below the viewport, so a flick does not flash. */
const OVERSCAN = 20;
/** Cell colors on Mod+1..5, in that order. */
const COLORS = ["amber", "rose", "sky", "lime", "violet"];
const ZOOM_KEY = "cascade.grid.zoom";

let host = null;
let wrap = null;
let table = null;
let head = null;
let body = null;
let editor = null;
let findBar = null;
let liveEl = null;

/** row -> measured pixel height, for the active sheet only. */
let heights = new Map();
/** Prefix sums of `heights`, rebuilt lazily. offsets[i] is row i's top. */
let offsets = [0];
let offsetsDirty = true;

let renderedSheetId = null;
let editing = null; // {row, col, original}
let liveSpeechId = null;
let findState = { query: "", matches: [], index: -1 };
let zoom = Number(localStorage.getItem(ZOOM_KEY)) || 1;

// --- Geometry ----------------------------------------------------------------

/** The row count the grid shows: stored rows plus one to type into. */
function rowCount(sheet) {
    return Math.max((sheet?.data?.length ?? 0) + 1, 1);
}

function rowHeight(row) {
    return heights.get(row) ?? ROW_ESTIMATE * zoom;
}

function rebuildOffsets(sheet) {
    const n = rowCount(sheet);
    offsets = new Array(n + 1);
    offsets[0] = 0;
    for (let i = 0; i < n; i += 1) offsets[i + 1] = offsets[i] + rowHeight(i);
    offsetsDirty = false;
}

function totalHeight(sheet) {
    if (offsetsDirty) rebuildOffsets(sheet);
    return offsets[offsets.length - 1] ?? 0;
}

/** First row whose bottom is past `y`. Binary search over the prefix sums. */
function rowAt(y) {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] <= y) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// --- Rendering ---------------------------------------------------------------

/** The sheet the grid is showing, or null. */
function activeSheet() {
    return store.activeSheet ?? null;
}

function columns(sheet) {
    try {
        return sheetColumns(store.round, sheet) ?? [];
    } catch (err) {
        console.error("[grid] could not derive columns:", err);
        return [];
    }
}

function renderHead(cols) {
    clear(head);
    const tr = el("tr");
    tr.append(el("th.cg-rowhead-th", { scope: "col", "aria-label": "Row" }));
    cols.forEach((col, i) => {
        const th = el("th", {
            scope: "col",
            class: [
                col.side === "aff" ? "col-aff" : "col-neg",
                col.id === liveSpeechId ? "col-live" : "",
            ]
                .filter(Boolean)
                .join(" "),
            title: col.name,
            "aria-colindex": i + 2,
            text: col.short ?? col.name,
        });
        tr.append(th);
    });
    head.append(tr);
}

/** The classes one cell's metadata asks for. */
function cellClasses(col, meta) {
    const classes = [col.side === "aff" ? "col-aff" : "col-neg"];
    if (!meta) return classes;
    if (meta.bold) classes.push("cell-bold");
    if (meta.highlight) classes.push("cell-highlight");
    if (meta.card) classes.push("cell-card");
    if (meta.group) classes.push("cell-group");
    if (meta.kicked) classes.push("cell-kicked");
    const ext = meta.cascade;
    if (ext) {
        if (ext.color && COLORS.includes(ext.color)) classes.push(`cell-color-${ext.color}`);
        if (ext.star) classes.push("cell-star");
        if (ext.flagged) classes.push("cell-flagged");
        if (ext.answered) classes.push("cell-answered");
        if (ext.voter) classes.push("cell-voter");
    }
    return classes;
}

/** Redraw the visible window. Cheap enough to call on every scroll frame. */
function render() {
    const sheet = activeSheet();
    if (!host) return;

    if (!sheet) {
        clear(body);
        clear(head);
        showEmpty("No sheet open. Press ⌘⇧A for a new aff sheet.");
        return;
    }
    if (sheet.id !== renderedSheetId) {
        heights = new Map();
        offsetsDirty = true;
        renderedSheetId = sheet.id;
        closeEditor(false);
    }
    hideEmpty();

    const cols = columns(sheet);
    renderHead(cols);

    if (offsetsDirty) rebuildOffsets(sheet);

    const n = rowCount(sheet);
    const viewTop = host.scrollTop;
    const viewBottom = viewTop + host.clientHeight;
    const start = Math.max(0, rowAt(viewTop) - OVERSCAN);
    const end = Math.min(n, rowAt(viewBottom) + OVERSCAN + 1);

    const sel = store.selection ?? { row: 0, col: 0 };
    const selTop = Math.min(sel.row, sel.anchorRow ?? sel.row);
    const selBottom = Math.max(sel.row, sel.anchorRow ?? sel.row);
    const selLeft = Math.min(sel.col, sel.anchorCol ?? sel.col);
    const selRight = Math.max(sel.col, sel.anchorCol ?? sel.col);

    const frag = document.createDocumentFragment();
    frag.append(spacer(offsets[start], cols.length + 1));

    for (let row = start; row < end; row += 1) {
        const tr = el("tr", { role: "row", "aria-rowindex": row + 1 });
        tr.append(el("th.cg-rowhead", { scope: "row", text: String(row + 1) }));
        for (let c = 0; c < cols.length; c += 1) {
            const meta = getMeta(sheet, row, c);
            const td = el("td", {
                role: "gridcell",
                class: cellClasses(cols[c], meta).join(" "),
                "aria-colindex": c + 2,
            });
            td.dataset.row = String(row);
            td.dataset.col = String(c);
            // textContent, never innerHTML: a cell holds whatever the other
            // team said, and one of them will eventually say "<script>".
            td.textContent = getCell(sheet, row, c);
            if (row >= selTop && row <= selBottom && c >= selLeft && c <= selRight) {
                td.classList.add("is-selected");
                td.setAttribute("aria-selected", "true");
            }
            tr.append(td);
        }
        frag.append(tr);
    }

    frag.append(spacer(totalHeight(sheet) - offsets[end], cols.length + 1));

    clear(body);
    body.append(frag);

    measure(start, end, sheet);
    positionEditor();
    if (findState.query) paintMatches();
    bus.emit("grid:rendered", { sheetId: sheet.id, start, end });
}

function spacer(height, span) {
    const tr = el("tr.cg-spacer", { "aria-hidden": "true" });
    tr.style.height = `${Math.max(0, height)}px`;
    tr.append(el("td", { colspan: String(span) }));
    return tr;
}

/**
 * Record what the browser actually laid out. A row whose measured height
 * differs from the cache invalidates the prefix sums, and one re-render lands
 * the window on the truth — guarded to a single pass so a row that measures
 * differently every time cannot spin.
 */
let measuring = false;
function measure(start, end, sheet) {
    if (measuring) return;
    let changed = false;
    const rows = body.querySelectorAll("tr:not(.cg-spacer)");
    rows.forEach((tr, i) => {
        const row = start + i;
        if (row >= end) return;
        const h = tr.offsetHeight;
        if (h > 0 && Math.abs((heights.get(row) ?? -1) - h) > 0.5) {
            heights.set(row, h);
            changed = true;
        }
    });
    if (!changed) return;
    offsetsDirty = true;
    rebuildOffsets(sheet);
    measuring = true;
    requestAnimationFrame(() => {
        measuring = false;
        render();
    });
}

function showEmpty(message) {
    hideEmpty();
    const node = el("div.grid-empty", { id: "cg-empty", text: message });
    wrap.append(node);
}

function hideEmpty() {
    $("#cg-empty", wrap)?.remove();
}

// --- Selection ---------------------------------------------------------------

function selection() {
    const s = store.selection ?? {};
    return {
        row: s.row ?? 0,
        col: s.col ?? 0,
        anchorRow: s.anchorRow ?? s.row ?? 0,
        anchorCol: s.anchorCol ?? s.col ?? 0,
    };
}

function select(row, col, { extend = false } = {}) {
    const sheet = activeSheet();
    if (!sheet) return;
    const cols = columns(sheet);
    const maxRow = rowCount(sheet) - 1;
    const r = Math.max(0, Math.min(row, maxRow));
    const c = Math.max(0, Math.min(col, Math.max(cols.length - 1, 0)));
    const prev = selection();
    store.setSelection({
        row: r,
        col: c,
        anchorRow: extend ? prev.anchorRow : r,
        anchorCol: extend ? prev.anchorCol : c,
    });
    scrollIntoView(r, c);
    render();
    announce(r, c, cols[c]);
    bus.emit("grid:selection", { sheetId: sheet.id, row: r, col: c });
}

function scrollIntoView(row, col) {
    if (offsetsDirty) rebuildOffsets(activeSheet());
    const top = offsets[row] ?? 0;
    const bottom = top + rowHeight(row);
    const headH = head?.offsetHeight ?? 0;
    if (top - headH < host.scrollTop) host.scrollTop = Math.max(0, top - headH - 4);
    else if (bottom > host.scrollTop + host.clientHeight) {
        host.scrollTop = bottom - host.clientHeight + 4;
    }
    // Columns are a fixed width, so the horizontal case is arithmetic.
    const cell = body.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
        const cr = cell.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        if (cr.left < hr.left) host.scrollLeft -= hr.left - cr.left + 8;
        else if (cr.right > hr.right) host.scrollLeft += cr.right - hr.right + 8;
    }
}

/** Announce the selected cell for screen readers, throttled by selection. */
function announce(row, col, column) {
    if (!liveEl) return;
    liveEl.textContent = `${column?.name ?? "Column " + (col + 1)}, row ${row + 1}`;
}

// --- Editing -----------------------------------------------------------------

function cellEl(row, col) {
    return body?.querySelector(`[data-row="${row}"][data-col="${col}"]`) ?? null;
}

/**
 * Open the editor over a cell. `seed` replaces the content (type-to-replace);
 * omitting it keeps what is there (Enter / double-click to amend).
 */
function openEditor(row, col, seed) {
    const sheet = activeSheet();
    if (!sheet) return;
    const original = getCell(sheet, row, col);
    editing = { row, col, original };
    editor.value = seed !== undefined ? seed : original;
    editor.hidden = false;
    positionEditor();
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
    autoGrow();
}

function positionEditor() {
    if (!editing || editor.hidden) return;
    const cell = cellEl(editing.row, editing.col);
    if (!cell) {
        // The cell scrolled out of the window; park the editor rather than
        // losing what is typed in it.
        editor.style.visibility = "hidden";
        return;
    }
    editor.style.visibility = "";
    const cr = cell.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    editor.style.left = `${cr.left - wr.left}px`;
    editor.style.top = `${cr.top - wr.top}px`;
    editor.style.width = `${cr.width}px`;
    editor.style.minHeight = `${cr.height}px`;
}

function autoGrow() {
    editor.style.height = "auto";
    editor.style.height = `${editor.scrollHeight}px`;
}

/** Commit what is in the editor, or discard it. */
function closeEditor(save = true) {
    if (!editing) return;
    const { row, col, original } = editing;
    const text = editor.value;
    editing = null;
    editor.hidden = true;
    editor.value = "";

    if (save && text !== original) {
        const sheet = activeSheet();
        store.commit(
            (round) => {
                const live = round.sheets.find((s) => s.id === sheet.id);
                if (!live) return;
                setCell(live, row, col, text);
                // Stamp when the cell was first typed; insights.js reads these
                // to show when in the round each argument actually landed.
                const meta = getMeta(live, row, col);
                if (!meta?.cascade?.ts) {
                    setMeta(live, row, col, { cascade: { ...(meta?.cascade ?? {}), ts: Date.now() } });
                }
            },
            { label: "Type", coalesce: `cell:${sheet.id}:${row}:${col}` },
        );
        bus.emit("grid:cellChanged", { sheetId: sheet.id, row, col, text });
    }
    heights.delete(row);
    offsetsDirty = true;
    render();
    host.focus();
}

// --- Mutations ---------------------------------------------------------------

/** Run a mutation against the live copy of the active sheet. */
function mutateSheet(fn, opts) {
    const sheet = activeSheet();
    if (!sheet) return;
    store.commit((round) => {
        const live = round.sheets.find((s) => s.id === sheet.id);
        if (live) fn(live, round);
    }, opts);
    heights = new Map();
    offsetsDirty = true;
    render();
}

function insertRow(at) {
    const cols = columns(activeSheet()).length;
    mutateSheet(
        (sheet) => {
            sheet.data.splice(at, 0, new Array(cols).fill(null));
            shiftMeta(sheet, at, +1);
        },
        { label: "Insert row" },
    );
}

function deleteRow(at) {
    mutateSheet(
        (sheet) => {
            if (at >= sheet.data.length) return;
            sheet.data.splice(at, 1);
            shiftMeta(sheet, at, -1);
        },
        { label: "Delete row" },
    );
}

/**
 * Move every cell decoration at or below `from` by `delta` rows. Metadata is
 * keyed by coordinate, so an inserted row would otherwise leave every
 * highlight below it pointing one argument too high.
 */
function shiftMeta(sheet, from, delta) {
    const next = {};
    for (const [key, value] of Object.entries(sheet.meta ?? {})) {
        const [r, c] = key.split(",").map(Number);
        if (r < from) next[key] = value;
        else if (delta < 0 && r === from) continue; // the deleted row's own marks
        else next[`${r + delta},${c}`] = value;
    }
    sheet.meta = next;
}

/** Toggle one boolean flag across the selection rectangle. */
function toggleFlag(flag, { cascade = false } = {}) {
    const sheet = activeSheet();
    if (!sheet) return;
    const s = selection();
    const r0 = Math.min(s.row, s.anchorRow);
    const r1 = Math.max(s.row, s.anchorRow);
    const c0 = Math.min(s.col, s.anchorCol);
    const c1 = Math.max(s.col, s.anchorCol);

    // The anchor cell decides the direction, so a mixed selection turns fully
    // on rather than half-toggling into a state nobody asked for.
    const anchorMeta = getMeta(sheet, s.row, s.col);
    const current = cascade ? !!anchorMeta?.cascade?.[flag] : !!anchorMeta?.[flag];
    const next = !current;

    mutateSheet(
        (live) => {
            for (let r = r0; r <= r1; r += 1) {
                for (let c = c0; c <= c1; c += 1) {
                    if (cascade) {
                        const prev = getMeta(live, r, c)?.cascade ?? {};
                        setMeta(live, r, c, { cascade: { ...prev, [flag]: next || undefined } });
                    } else {
                        setMeta(live, r, c, { [flag]: next || undefined });
                    }
                }
            }
        },
        { label: `Toggle ${flag}` },
    );
}

function setColor(name) {
    const sheet = activeSheet();
    if (!sheet) return;
    const s = selection();
    const current = getMeta(sheet, s.row, s.col)?.cascade?.color;
    const next = current === name ? undefined : name;
    const r0 = Math.min(s.row, s.anchorRow);
    const r1 = Math.max(s.row, s.anchorRow);
    const c0 = Math.min(s.col, s.anchorCol);
    const c1 = Math.max(s.col, s.anchorCol);
    mutateSheet(
        (live) => {
            for (let r = r0; r <= r1; r += 1) {
                for (let c = c0; c <= c1; c += 1) {
                    const prev = getMeta(live, r, c)?.cascade ?? {};
                    setMeta(live, r, c, { cascade: { ...prev, color: next } });
                }
            }
        },
        { label: "Color" },
    );
}

// --- Clipboard ---------------------------------------------------------------

/** The selection as TSV, quoted the way a spreadsheet expects. */
function selectionToTsv() {
    const sheet = activeSheet();
    if (!sheet) return "";
    const s = selection();
    const rows = [];
    for (let r = Math.min(s.row, s.anchorRow); r <= Math.max(s.row, s.anchorRow); r += 1) {
        const cells = [];
        for (let c = Math.min(s.col, s.anchorCol); c <= Math.max(s.col, s.anchorCol); c += 1) {
            const text = getCell(sheet, r, c);
            cells.push(/[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
        }
        rows.push(cells.join("\t"));
    }
    return rows.join("\n");
}

/** Parse TSV back into a grid, honoring quoted fields with newlines inside. */
function tsvToGrid(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') {
                field += '"';
                i += 1;
            } else if (ch === '"') quoted = false;
            else field += ch;
            continue;
        }
        if (ch === '"' && field === "") quoted = true;
        else if (ch === "\t") {
            row.push(field);
            field = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i += 1;
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else field += ch;
    }
    if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function pasteGrid(grid) {
    const s = selection();
    mutateSheet(
        (sheet) => {
            grid.forEach((cells, dr) => {
                cells.forEach((text, dc) => setCell(sheet, s.row + dr, s.col + dc, text));
            });
        },
        { label: "Paste" },
    );
}

// --- Find --------------------------------------------------------------------

function openFind() {
    findBar.hidden = false;
    const input = $("input", findBar);
    input.value = findState.query;
    input.focus();
    input.select();
}

function closeFind() {
    findBar.hidden = true;
    findState = { query: "", matches: [], index: -1 };
    render();
    host.focus();
}

function runFind(query) {
    const sheet = activeSheet();
    findState.query = query;
    findState.matches = [];
    findState.index = -1;
    if (!sheet || !query) return paintMatches();
    const needle = query.toLowerCase();
    const cols = columns(sheet).length;
    for (let r = 0; r < (sheet.data?.length ?? 0); r += 1) {
        for (let c = 0; c < cols; c += 1) {
            if (getCell(sheet, r, c).toLowerCase().includes(needle)) findState.matches.push({ r, c });
        }
    }
    $(".cg-find-count", findBar).textContent = findState.matches.length
        ? `1 of ${findState.matches.length}`
        : "no matches";
    if (findState.matches.length) stepFind(0);
    else paintMatches();
}

function stepFind(delta) {
    if (!findState.matches.length) return;
    findState.index = (findState.index + delta + findState.matches.length) % findState.matches.length;
    const { r, c } = findState.matches[findState.index];
    $(".cg-find-count", findBar).textContent = `${findState.index + 1} of ${findState.matches.length}`;
    select(r, c);
}

function paintMatches() {
    for (const node of body.querySelectorAll(".cg-match, .cg-match-active")) {
        node.classList.remove("cg-match", "cg-match-active");
    }
    findState.matches.forEach((m, i) => {
        const cell = cellEl(m.r, m.c);
        if (cell) cell.classList.add(i === findState.index ? "cg-match-active" : "cg-match");
    });
}

// --- Keyboard ----------------------------------------------------------------

function onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;

    if (editing) return onEditorKey(e, mod);
    if (e.target !== host && e.target !== body && !host.contains(e.target)) return;
    if (e.target.tagName === "INPUT") return; // the find bar owns its own keys

    const s = selection();
    const sheet = activeSheet();
    if (!sheet) return;
    const cols = columns(sheet).length;

    switch (e.key) {
        case "ArrowUp":
            select(s.row - 1, s.col, { extend: e.shiftKey });
            return e.preventDefault();
        case "ArrowDown":
            select(s.row + 1, s.col, { extend: e.shiftKey });
            return e.preventDefault();
        case "ArrowLeft":
            select(s.row, s.col - 1, { extend: e.shiftKey });
            return e.preventDefault();
        case "ArrowRight":
            select(s.row, s.col + 1, { extend: e.shiftKey });
            return e.preventDefault();
        case "Tab":
            // The gesture the whole app is built around: Tab lands in the same
            // row one column right, which is what answering an argument is.
            select(s.row, s.col + (e.shiftKey ? -1 : 1));
            return e.preventDefault();
        case "Enter":
            if (mod) {
                // A new argument in the next column, aligned under this one.
                const target = Math.min(s.col + 1, cols - 1);
                insertRow(s.row + 1);
                select(s.row + 1, target);
                openEditor(s.row + 1, target, "");
            } else {
                openEditor(s.row, s.col);
            }
            return e.preventDefault();
        case "Backspace":
        case "Delete":
            if (mod) deleteRow(s.row);
            else clearSelection();
            return e.preventDefault();
        case "Home":
            select(mod ? 0 : s.row, 0, { extend: e.shiftKey });
            return e.preventDefault();
        case "End":
            select(mod ? rowCount(sheet) - 1 : s.row, cols - 1, { extend: e.shiftKey });
            return e.preventDefault();
        case "PageDown":
            select(s.row + 15, s.col, { extend: e.shiftKey });
            return e.preventDefault();
        case "PageUp":
            select(s.row - 15, s.col, { extend: e.shiftKey });
            return e.preventDefault();
        case "Escape":
            if (!findBar.hidden) closeFind();
            return;
        default:
            break;
    }

    if (mod && e.key.toLowerCase() === "a") {
        store.setSelection({ row: 0, col: 0, anchorRow: rowCount(sheet) - 1, anchorCol: cols - 1 });
        render();
        return e.preventDefault();
    }

    // Type-to-replace. Printable characters only, and never while a modifier
    // that means a command is held.
    if (!mod && !e.altKey && e.key.length === 1) {
        openEditor(s.row, s.col, e.key);
        e.preventDefault();
    }
}

function onEditorKey(e, mod) {
    const s = { row: editing.row, col: editing.col };
    if (e.key === "Escape") {
        closeEditor(false);
        return e.preventDefault();
    }
    if (e.key === "Enter" && e.altKey) return; // newline inside the cell
    if (e.key === "Enter" && !e.shiftKey && !mod) {
        closeEditor(true);
        select(s.row + 1, s.col);
        return e.preventDefault();
    }
    if (e.key === "Tab") {
        closeEditor(true);
        select(s.row, s.col + (e.shiftKey ? -1 : 1));
        return e.preventDefault();
    }
}

function clearSelection() {
    const s = selection();
    mutateSheet(
        (sheet) => {
            for (let r = Math.min(s.row, s.anchorRow); r <= Math.max(s.row, s.anchorRow); r += 1) {
                for (let c = Math.min(s.col, s.anchorCol); c <= Math.max(s.col, s.anchorCol); c += 1) {
                    setCell(sheet, r, c, "");
                }
            }
        },
        { label: "Clear" },
    );
}

// --- Mounting ----------------------------------------------------------------

/** Build the DOM the grid lives in. Idempotent. */
export function mountGrid(hostEl) {
    host = hostEl ?? $("#grid-host");
    if (!host) return console.error("[grid] no #grid-host to mount into");
    injectStructuralCss();

    wrap = el("div.cg-wrap");
    table = el("table.flow-grid", { role: "grid", "aria-label": "Flow" });
    head = el("thead");
    body = el("tbody");
    table.append(head, body);

    editor = el("textarea.cg-editor", { hidden: true, spellcheck: "false", "aria-label": "Edit cell" });
    editor.addEventListener("input", autoGrow);
    editor.addEventListener("blur", () => editing && closeEditor(true));

    findBar = buildFindBar();
    liveEl = el("div.cg-live", { "aria-live": "polite", "aria-atomic": "true" });

    wrap.append(table, editor, findBar, liveEl);
    // The HUD is already inside #grid-host and must stay above the table.
    host.append(wrap);
    host.tabIndex = 0;
    host.style.setProperty("--grid-scale", String(zoom));

    host.addEventListener("scroll", onScroll, { passive: true });
    host.addEventListener("keydown", onKeyDown);
    host.addEventListener("mousedown", onMouseDown);
    host.addEventListener("dblclick", onDoubleClick);
    host.addEventListener("copy", onCopy);
    host.addEventListener("cut", onCut);
    host.addEventListener("paste", onPaste);
    window.addEventListener("resize", debounce(render, 80));

    bus.on("round:change", render);
    bus.on("sheet:change", render);
    bus.on("selection:change", render);
    bus.on("file:opened", () => {
        heights = new Map();
        offsetsDirty = true;
        renderedSheetId = null;
        render();
    });
    bus.on("grid:goto", ({ sheetId, row, col }) => grid.goto(sheetId, row, col));
    bus.on("grid:insertText", ({ text, newRow }) => grid.insertText(text, { newRow }));
    bus.on("timer:speech", ({ speechId }) => {
        liveSpeechId = speechId ?? null;
        render();
    });

    registerCommands();
    render();
}

function buildFindBar() {
    const input = el("input", { type: "search", placeholder: "Find in sheet", "aria-label": "Find in sheet" });
    const count = el("span.cg-find-count", { text: "" });
    input.addEventListener("input", () => runFind(input.value));
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            stepFind(e.shiftKey ? -1 : 1);
            e.preventDefault();
        } else if (e.key === "Escape") {
            closeFind();
            e.preventDefault();
        }
    });
    const bar = el(
        "div.cg-find",
        { hidden: true },
        input,
        count,
        el("button", { type: "button", "aria-label": "Close find", onClick: closeFind, text: "×" }),
    );
    return bar;
}

const onScroll = () => {
    render();
    positionEditor();
};

function onMouseDown(e) {
    const cell = e.target.closest?.("[data-row][data-col]");
    if (!cell) return;
    if (editing) closeEditor(true);
    select(Number(cell.dataset.row), Number(cell.dataset.col), { extend: e.shiftKey });
}

function onDoubleClick(e) {
    const cell = e.target.closest?.("[data-row][data-col]");
    if (!cell) return;
    openEditor(Number(cell.dataset.row), Number(cell.dataset.col));
}

function onCopy(e) {
    if (editing) return;
    e.clipboardData?.setData("text/plain", selectionToTsv());
    e.preventDefault();
}

function onCut(e) {
    if (editing) return;
    e.clipboardData?.setData("text/plain", selectionToTsv());
    clearSelection();
    e.preventDefault();
}

function onPaste(e) {
    if (editing) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    pasteGrid(tsvToGrid(text));
    e.preventDefault();
}

// --- Commands ----------------------------------------------------------------

function registerCommands() {
    registry.registerAll([
        {
            id: "format.toggleBold",
            title: "Bold",
            category: "Format",
            keys: ["Mod+B"],
            run: () => toggleFlag("bold"),
        },
        {
            id: "format.toggleHighlight",
            title: "Highlight",
            category: "Format",
            keys: ["Mod+Shift+H"],
            run: () => toggleFlag("highlight"),
        },
        {
            id: "format.toggleCard",
            title: "Mark as card",
            category: "Format",
            keys: ["Mod+T"],
            run: () => toggleFlag("card"),
        },
        {
            id: "format.toggleGroup",
            title: "Group",
            category: "Format",
            keys: ["Mod+G"],
            run: () => toggleFlag("group"),
        },
        {
            id: "format.toggleKicked",
            title: "Mark kicked (argument is dead)",
            category: "Format",
            keys: ["Mod+K"],
            run: () => toggleFlag("kicked"),
        },
        {
            id: "format.star",
            title: "Star",
            category: "Format",
            keys: ["Mod+Shift+8"],
            run: () => toggleFlag("star", { cascade: true }),
        },
        {
            id: "format.flag",
            title: "Flag for the rebuttal",
            category: "Format",
            run: () => toggleFlag("flagged", { cascade: true }),
        },
        {
            id: "format.voter",
            title: "Mark as a voter",
            category: "Format",
            run: () => toggleFlag("voter", { cascade: true }),
        },
        ...COLORS.map((name, i) => ({
            id: `format.color${i + 1}`,
            title: `Color: ${name}`,
            category: "Format",
            keys: [`Mod+${i + 1}`],
            run: () => setColor(name),
        })),
        {
            id: "row.insertAbove",
            title: "Insert row above",
            category: "Edit",
            keys: ["Mod+O"],
            run: () => insertRow(selection().row),
        },
        {
            id: "row.insertBelow",
            title: "Insert row below",
            category: "Edit",
            keys: ["Mod+Shift+O"],
            run: () => insertRow(selection().row + 1),
        },
        {
            id: "row.delete",
            title: "Delete row",
            category: "Edit",
            run: () => deleteRow(selection().row),
        },
        {
            id: "grid.find",
            title: "Find in sheet",
            category: "Edit",
            keys: ["Mod+F"],
            run: openFind,
        },
        {
            id: "grid.zoomIn",
            title: "Zoom in",
            category: "View",
            keys: ["Mod+="],
            run: () => grid.setZoom(zoom + 0.1),
        },
        {
            id: "grid.zoomOut",
            title: "Zoom out",
            category: "View",
            keys: ["Mod+-"],
            run: () => grid.setZoom(zoom - 0.1),
        },
        {
            id: "grid.zoomReset",
            title: "Reset zoom",
            category: "View",
            keys: ["Mod+0"],
            run: () => grid.setZoom(1),
        },
    ]);
}

// --- Public API --------------------------------------------------------------

export const grid = {
    focus: () => host?.focus(),

    /** Select a cell, switching sheets first when the target is elsewhere. */
    goto(sheetId, row = 0, col = 0) {
        if (sheetId && sheetId !== store.activeSheetId) store.setActiveSheet(sheetId);
        select(row, col);
        host?.focus();
    },

    /**
     * Push text in from outside — voice capture and the block library both
     * arrive here. `newRow` puts it on a fresh row below rather than appending
     * to whatever the debater is already looking at.
     */
    insertText(text, { newRow = false } = {}) {
        const sheet = activeSheet();
        if (!sheet || !text) return;
        const s = selection();
        const row = newRow ? nextFreeRow(sheet, s.col, s.row) : s.row;
        const existing = newRow ? "" : getCell(sheet, row, s.col);
        const merged = existing ? `${existing}\n${text}` : text;
        mutateSheet((live) => setCell(live, row, s.col, merged), { label: "Insert text" });
        select(row, s.col);
    },

    getSelectionRect() {
        const s = selection();
        return {
            top: Math.min(s.row, s.anchorRow),
            bottom: Math.max(s.row, s.anchorRow),
            left: Math.min(s.col, s.anchorCol),
            right: Math.max(s.col, s.anchorCol),
        };
    },

    refresh: render,

    setZoom(value) {
        zoom = Math.max(0.7, Math.min(1.8, Math.round(value * 10) / 10));
        localStorage.setItem(ZOOM_KEY, String(zoom));
        host?.style.setProperty("--grid-scale", String(zoom));
        heights = new Map();
        offsetsDirty = true;
        render();
    },
};

/** The first empty row at or below `from` in this column, so dictation stacks. */
function nextFreeRow(sheet, col, from) {
    for (let r = from; r < rowCount(sheet); r += 1) {
        if (!getCell(sheet, r, col)) return r;
    }
    return rowCount(sheet) - 1;
}

// --- Structural CSS ----------------------------------------------------------

/**
 * Only what the grid cannot function without: the editor overlay's positioning,
 * the find bar, the row header, and the classes links.js writes onto cells.
 * Colors and typography stay in app.css, so a theme change never has to touch
 * this file.
 */
function injectStructuralCss() {
    if (document.getElementById("cg-structural")) return;
    const style = el("style", { id: "cg-structural" });
    style.textContent = `
.cg-wrap { position: relative; min-height: 100%; }
.flow-grid { table-layout: fixed; width: max-content; }
.flow-grid col, .flow-grid th, .flow-grid td { width: 160px; }
.flow-grid th.cg-rowhead-th, .flow-grid th.cg-rowhead { width: 38px; }
.flow-grid { font-size: calc(12px * var(--grid-scale, 1)); }
.cg-rowhead {
    position: sticky; left: 0; z-index: 2;
    background: var(--bg-1); color: var(--text-3);
    font-weight: 400; font-size: 10px; text-align: right;
    padding: 4px 6px; border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border); user-select: none;
}
.flow-grid th.cg-rowhead-th { position: sticky; left: 0; z-index: 4; }
.cg-spacer td { padding: 0; border: 0; }
.cg-editor {
    position: absolute; z-index: 8; margin: 0;
    padding: 4px 10px; resize: none; overflow: hidden;
    font: inherit; font-family: var(--font-mono);
    font-size: calc(12px * var(--grid-scale, 1)); line-height: 1.5;
    color: var(--text-0); background: var(--bg-3);
    border: 1.5px solid var(--d1-accent-2); border-radius: 2px;
    outline: none; box-shadow: 0 6px 20px rgba(0,0,0,0.35);
}
.cg-editor[hidden] { display: none; }
.cg-find {
    position: sticky; top: 8px; float: right; right: 12px;
    z-index: 9; display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 8px; margin-right: 12px;
    background: var(--bg-2); border: 1px solid var(--border-strong);
    border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.cg-find[hidden] { display: none; }
.cg-find input {
    background: var(--bg-0); border: 1px solid var(--border);
    color: var(--text-0); padding: 4px 8px; border-radius: 3px;
    font-size: 12px; width: 180px;
}
.cg-find-count { font-size: 10px; color: var(--text-2); font-family: var(--font-mono); }
.cg-find button { color: var(--text-2); font-size: 14px; line-height: 1; padding: 2px 6px; }
.cg-live {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0); white-space: nowrap;
}
.cg-match { outline: 1px dashed var(--warn); outline-offset: -1px; }
.cg-match-active { outline: 2px solid var(--warn); outline-offset: -2px; }
.cg-dropped { box-shadow: inset 0 -2px 0 var(--danger); }
.cg-link-source { box-shadow: inset -3px 0 0 var(--d1-accent-2); }
.cg-link-target { box-shadow: inset 3px 0 0 var(--d1-accent-2); }
`;
    document.head.append(style);
}

export default grid;
