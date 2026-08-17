/**
 * Cascade — the sheet sidebar.
 *
 * A round is a stack of sheets (one CX sheet pinned on top, then aff sheets,
 * then neg sheets), and this module is the only place that lets a debater
 * see that stack, switch between sheets mid-speech, and reorder or rename
 * them without touching the grid itself. It owns none of the round's data —
 * every mutation goes through `store.commit()` so undo/redo and autosave stay
 * correct — and it never reaches into grid.js; the grid picks up the new
 * active sheet by listening to the store the same way this module does.
 */

import { bus } from "./bus.js";
import { el, clear, debounce } from "./dom.js";
import { registerAll } from "./registry.js";
import { ui } from "./ui.js";
import { store } from "./store.js";
import { sortedSheets, sheetRangeIds, moveSheetRange, dropSheetRange, makeFlowSheet, uid, firstFlowSheetId } from "./model.js";

let hostEl = null;
let commandsRegistered = false;

/** @type {Set<string>} sheet ids currently multi-selected (Shift/Mod-click, drag, delete/duplicate targets) */
let selectedIds = new Set();
/** anchor for Shift+click range selection */
let anchorId = null;
/** {id} while a title is being edited inline; render() no-ops while this is set so the input isn't yanked out from under the debater */
let renameState = null;
/** {grabbedId, side} while a drag is in flight */
let dragState = null;

// --- Grouping ----------------------------------------------------------------

/**
 * Split the round's sheets into the three visual buckets: the pinned CX
 * sheet(s), aff, and neg. `sortedSheets` already orders each bucket by
 * `compareSheets` (CX first via order -1, then ascending order).
 */
function computeGroups(round) {
    const all = sortedSheets(round);
    const cx = all.filter((s) => s.kind === "cx");
    const aff = all.filter((s) => s.kind !== "cx" && s.group === "aff");
    const neg = all.filter((s) => s.kind !== "cx" && s.group === "neg");
    return { all, cx, aff, neg };
}

function nextTitle(round, group) {
    const count = round.sheets.filter((s) => s.kind !== "cx" && s.group === group).length;
    return `${count + 1}.`;
}

function nextOrder(round, group) {
    const orders = round.sheets.filter((s) => s.kind !== "cx" && s.group === group).map((s) => s.order);
    return orders.length ? Math.max(...orders) + 1 : 0;
}

// --- Mutations -----------------------------------------------------------------

/** Create a new flow sheet in `group` ("aff" | "neg") and make it active. */
function newSheet(group) {
    const round = store.round;
    if (!round) return;
    const sheet = makeFlowSheet({ title: nextTitle(round, group), group, order: nextOrder(round, group) });
    store.commit((r) => r.sheets.push(sheet), { label: `New ${group} sheet` });
    store.setActiveSheet(sheet.id);
    selectedIds = new Set([sheet.id]);
    anchorId = sheet.id;
    render();
}

/** Delete the given sheet ids after a confirmation. */
async function deleteSheets(ids) {
    if (!ids.length) return;
    const plural = ids.length > 1;
    const ok = await ui.confirm(
        plural ? `Delete these ${ids.length} sheets? This can't be undone once you leave the round.` : "Delete this sheet? This can't be undone once you leave the round.",
        { title: plural ? "Delete sheets" : "Delete sheet", confirmLabel: "Delete", danger: true },
    );
    if (!ok) return;

    const wasActive = ids.includes(store.activeSheetId);
    store.commit((r) => {
        r.sheets = r.sheets.filter((s) => !ids.includes(s.id));
    }, { label: plural ? "Delete sheets" : "Delete sheet" });

    selectedIds = new Set();
    if (wasActive) {
        const fallback = firstFlowSheetId(store.round);
        if (fallback) store.setActiveSheet(fallback);
    }
    render();
}

/** Duplicate the given sheet ids, appended to the end of their own group. */
function duplicateSheets(ids) {
    if (!ids.length) return;
    const newIds = [];
    store.commit((r) => {
        for (const id of ids) {
            const src = r.sheets.find((s) => s.id === id);
            if (!src) continue;
            const orders = r.sheets.filter((s) => s.kind !== "cx" && s.group === src.group).map((s) => s.order);
            const order = src.kind === "cx" ? src.order : orders.length ? Math.max(...orders) + 1 : 0;
            const copy = {
                ...src,
                id: uid("sheet"),
                title: `${src.title} copy`,
                order,
                data: (src.data ?? []).map((row) => (Array.isArray(row) ? [...row] : row)),
                meta: src.meta ? { ...src.meta } : {},
            };
            r.sheets.push(copy);
            newIds.push(copy.id);
        }
    }, { label: newIds.length > 1 ? "Duplicate sheets" : "Duplicate sheet" });
    selectedIds = new Set(newIds);
    render();
}

function beginRename(id) {
    renameState = { id };
    render();
}

function commitRename(id, value) {
    const title = value.trim();
    renameState = null;
    if (title) {
        store.commit((r) => {
            const s = r.sheets.find((x) => x.id === id);
            if (s) s.title = title;
        }, { label: "Rename sheet", coalesce: `sheet-rename-${id}` });
    }
    render();
}

function cancelRename() {
    renameState = null;
    render();
}

/** Reorder `ids` by `delta` positions within `orderedIds` (same group only). */
function reorderBySteps(orderedIds, ids, delta) {
    if (!ids.length) return;
    const newOrder = moveSheetRange(orderedIds, ids, delta);
    store.commit((r) => {
        newOrder.forEach((id, idx) => {
            const s = r.sheets.find((x) => x.id === id);
            if (s) s.order = idx;
        });
    }, { label: "Reorder sheets" });
    render();
}

function stepActiveSheet(delta) {
    const round = store.round;
    if (!round) return;
    const ids = sortedSheets(round).map((s) => s.id);
    if (!ids.length) return;
    const idx = ids.indexOf(store.activeSheetId);
    const next = ids[(idx + delta + ids.length) % ids.length];
    store.setActiveSheet(next);
    selectedIds = new Set([next]);
    anchorId = next;
}

function jumpToIndex(i) {
    const round = store.round;
    if (!round) return;
    const ids = sortedSheets(round).map((s) => s.id);
    if (i >= ids.length) return;
    store.setActiveSheet(ids[i]);
    selectedIds = new Set([ids[i]]);
    anchorId = ids[i];
}

function currentSelectionOrActive() {
    if (selectedIds.size) return [...selectedIds];
    return store.activeSheetId ? [store.activeSheetId] : [];
}

// --- Drag and drop -------------------------------------------------------------

function onDragStart(e, sheet, side, rowEl) {
    if (side === "cx") {
        e.preventDefault();
        return;
    }
    if (!selectedIds.has(sheet.id)) {
        selectedIds = new Set([sheet.id]);
        anchorId = sheet.id;
    }
    dragState = { grabbedId: sheet.id, side };
    e.dataTransfer.effectAllowed = "move";
    try {
        e.dataTransfer.setData("text/plain", sheet.id);
    } catch {
        // Some browsers restrict setData outside a user gesture context; the
        // drag still works locally since we track state in module scope.
    }
    rowEl.classList.add("is-dragging");
}

function onDragOver(e, sheet, side, rowEl) {
    if (!dragState || dragState.side !== side) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    rowEl.classList.add("is-drop-target");
}

function onDrop(e, sheet, side, orderedIds) {
    e.preventDefault();
    if (!dragState || dragState.side !== side) {
        dragState = null;
        return;
    }
    const moving = orderedIds.filter((id) => selectedIds.has(id));
    const ids = moving.length ? moving : [dragState.grabbedId];
    const newOrder = dropSheetRange(orderedIds, ids, sheet.id);
    store.commit((r) => {
        newOrder.forEach((id, idx) => {
            const s = r.sheets.find((x) => x.id === id);
            if (s) s.order = idx;
        });
    }, { label: "Reorder sheets" });
    dragState = null;
    render();
}

function onDragEnd(rowEl) {
    dragState = null;
    rowEl.classList.remove("is-dragging");
    render();
}

// --- Selection / activation ------------------------------------------------

function onRowClick(e, sheet, list) {
    if (e.shiftKey && anchorId) {
        // sheetRangeIds wants the sheet objects themselves (it sorts by
        // compareSheets internally), not the plain id list used elsewhere.
        selectedIds = new Set(sheetRangeIds(list, anchorId, sheet.id));
    } else if (e.metaKey || e.ctrlKey) {
        const next = new Set(selectedIds);
        if (next.has(sheet.id)) next.delete(sheet.id);
        else next.add(sheet.id);
        selectedIds = next;
        anchorId = sheet.id;
    } else {
        selectedIds = new Set([sheet.id]);
        anchorId = sheet.id;
    }
    store.setActiveSheet(sheet.id);
    render();
}

function onRowKeydown(e, sheet, side, orderedIds) {
    if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectedIds = new Set([sheet.id]);
        anchorId = sheet.id;
        store.setActiveSheet(sheet.id);
        render();
    } else if (e.key === "F2") {
        e.preventDefault();
        beginRename(sheet.id);
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (side === "cx") return;
        e.preventDefault();
        const ids = orderedIds.filter((id) => selectedIds.has(id));
        reorderBySteps(orderedIds, ids.length ? ids : [sheet.id], e.key === "ArrowUp" ? -1 : 1);
    }
}

// --- Rendering -------------------------------------------------------------------

function buildHeader() {
    return el(
        "div.sheets-header",
        null,
        el("span.sheets-header-title", { text: "Sheets" }),
        el(
            "div.sheets-header-actions",
            null,
            el("button#sheet-new-aff.btn-sheet-add", {
                type: "button",
                title: "New affirmative sheet (Mod+Shift+A)",
                "aria-label": "New affirmative sheet",
                onClick: () => newSheet("aff"),
            }, "+"),
            el("button#sheet-new-neg.btn-sheet-add", {
                type: "button",
                title: "New negative sheet (Mod+Shift+N)",
                "aria-label": "New negative sheet",
                onClick: () => newSheet("neg"),
            }, "+"),
        ),
    );
}

function buildRow(sheet, side, list, orderedIds) {
    const isActive = store.activeSheetId === sheet.id;
    const isSelected = selectedIds.has(sheet.id);
    const rowCount = Array.isArray(sheet.data) ? sheet.data.length : 0;

    let titleNode;
    if (renameState && renameState.id === sheet.id) {
        const input = el("input.sheet-title-input", { type: "text", value: sheet.title });
        // Focus after the node is attached to the document (mount happens
        // synchronously right after this function returns).
        queueMicrotask(() => {
            input.focus();
            input.select();
        });
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                commitRename(sheet.id, input.value);
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
            }
        });
        input.addEventListener("blur", () => commitRename(sheet.id, input.value));
        input.addEventListener("click", (e) => e.stopPropagation());
        titleNode = input;
    } else {
        titleNode = el("span.sheet-title", { text: sheet.title });
    }

    const row = el(
        "div.sheet-row",
        {
            "data-sheet-id": sheet.id,
            "data-side": side,
            role: "option",
            tabindex: "0",
            "aria-selected": isSelected ? "true" : "false",
            class: [isActive ? "is-active" : "", isSelected ? "is-selected" : ""].filter(Boolean).join(" "),
            draggable: side === "cx" ? "false" : "true",
            onClick: (e) => onRowClick(e, sheet, list),
            onDblclick: () => beginRename(sheet.id),
            onKeydown: (e) => onRowKeydown(e, sheet, side, orderedIds),
            onDragstart: (e) => onDragStart(e, sheet, side, row),
            onDragover: (e) => onDragOver(e, sheet, side, row),
            onDragleave: () => row.classList.remove("is-drop-target"),
            onDrop: (e) => onDrop(e, sheet, side, orderedIds),
            onDragend: () => onDragEnd(row),
        },
        el("span.sheet-color-bar"),
        titleNode,
        el("span.sheet-rowcount", { text: String(rowCount) }),
    );
    return row;
}

function buildGroup(label, list, side) {
    const groupEl = el("div.sheets-group", { "data-group": side });
    groupEl.append(el("div.sheets-group-label", { text: label }));
    if (!list.length) {
        groupEl.append(el("p.sheets-empty", { text: `No ${side === "cx" ? "CX" : side} sheets yet.` }));
        return groupEl;
    }
    const orderedIds = list.map((s) => s.id);
    for (const sheet of list) groupEl.append(buildRow(sheet, side, list, orderedIds));
    return groupEl;
}

/** Rebuild the sidebar from the current round. Skipped mid-rename so the debater's edit isn't lost. */
function render() {
    if (!hostEl || renameState) return;
    clear(hostEl);

    const round = store.round;
    const panel = el("div.sheets-panel");
    panel.append(buildHeader());

    const list = el("div.sheets-list", { role: "listbox", "aria-multiselectable": "true" });
    if (!round) {
        list.append(el("p.sheets-empty", { text: "No round open." }));
    } else {
        const { cx, aff, neg } = computeGroups(round);
        if (cx.length) list.append(buildGroup("Cross-ex", cx, "cx"));
        list.append(buildGroup("Affirmative", aff, "aff"));
        list.append(buildGroup("Negative", neg, "neg"));
    }
    panel.append(list);
    hostEl.append(panel);
}

const scheduleRender = debounce(() => render(), 120);

// --- Commands --------------------------------------------------------------------

function registerCommands() {
    const jumpCommands = Array.from({ length: 9 }, (_, i) => ({
        id: `sheet.jump${i + 1}`,
        title: `Jump to sheet ${i + 1}`,
        category: "Sheets",
        // grid.js claims Mod+1..5 for cell colors, so sheet jumps live on Mod+Alt+1..9.
        keys: [`Mod+Alt+${i + 1}`],
        hidden: true,
        run: () => jumpToIndex(i),
    }));

    registerAll([
        {
            id: "sheet.newAff",
            title: "New affirmative sheet",
            category: "Sheets",
            icon: "+",
            keys: ["Mod+Shift+A"],
            run: () => newSheet("aff"),
        },
        {
            id: "sheet.newNeg",
            title: "New negative sheet",
            category: "Sheets",
            icon: "+",
            keys: ["Mod+Shift+N"],
            run: () => newSheet("neg"),
        },
        {
            id: "sheet.rename",
            title: "Rename sheet",
            category: "Sheets",
            keys: ["Mod+R"],
            when: () => !!store.activeSheetId,
            run: () => store.activeSheetId && beginRename(store.activeSheetId),
        },
        {
            id: "sheet.next",
            title: "Next sheet",
            category: "Sheets",
            keys: ["Mod+]"],
            run: () => stepActiveSheet(1),
        },
        {
            id: "sheet.prev",
            title: "Previous sheet",
            category: "Sheets",
            keys: ["Mod+["],
            run: () => stepActiveSheet(-1),
        },
        {
            id: "sheet.delete",
            title: "Delete sheet",
            category: "Sheets",
            run: () => deleteSheets(currentSelectionOrActive()),
        },
        {
            id: "sheet.duplicate",
            title: "Duplicate sheet",
            category: "Sheets",
            run: () => duplicateSheets(currentSelectionOrActive()),
        },
        {
            id: "sidebar.toggle",
            title: "Toggle sheet sidebar",
            category: "View",
            keys: ["Mod+\\"],
            run: () => document.getElementById("sidebar-toggle")?.click(),
        },
        ...jumpCommands,
    ]);
}

// --- Public API ------------------------------------------------------------------

/**
 * Mount the sheet sidebar into `host` (the shell's `#sidebar`). Safe to call
 * once; command registration happens on first mount only.
 * @param {HTMLElement} host
 */
export function mountSheets(host) {
    hostEl = host;
    if (!commandsRegistered) {
        registerCommands();
        commandsRegistered = true;
    }
    bus.on("round:change", scheduleRender);
    bus.on("sheet:change", scheduleRender);
    render();
}

export const sheets = {
    /** Force an immediate re-render, bypassing the debounce. */
    refresh() {
        scheduleRender.cancel();
        render();
    },
    /** Move focus into the sheet list, landing on the active sheet if any. */
    focus() {
        const target = hostEl?.querySelector(".sheet-row.is-active") ?? hostEl?.querySelector(".sheet-row");
        target?.focus();
    },
    /** The ids currently multi-selected in the sidebar. */
    selectedIds() {
        return [...selectedIds];
    },
    /** Programmatically activate a sheet, as if it were clicked. */
    activate(id) {
        selectedIds = new Set([id]);
        anchorId = id;
        store.setActiveSheet(id);
        render();
    },
};

export default sheets;
