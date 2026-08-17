/**
 * Handsontable-native round model. Each sheet stores its grid as a 2D array of
 * cell text plus sparse per-cell metadata; columns are never stored (they
 * derive from the round's event definition and the sheet's startSpeechId
 * slice). Ported from ebb's src/lib/model/flow.ts, same names and semantics,
 * plus the Cascade-only cell/sheet/cascade helpers at the bottom.
 */

import { getEvent, speechOrder } from "./events.js";

/**
 * @typedef {Object} CellSource
 * @property {string} app - origin app id from the cardmirror-bridge handshake
 * @property {string} token - the origin's opaque provenance token
 * @property {string} key - stable equality key the origin mints
 * @property {string} [title] - origin document title, for "open X first"
 */

/**
 * @typedef {Object} CellMeta
 * @property {boolean} [bold]
 * @property {boolean} [highlight]
 * @property {boolean} [card] - tags the cell as a card (a piece of evidence)
 * @property {boolean} [group] - part of a visual group (a left bar hugging the run)
 * @property {boolean} [kicked] - the argument is dead: kicked, turned, or dropped
 * @property {{sheetId: string, row: number, col: number}} [answers]
 * @property {CellSource} [source]
 * @property {Object} [cascade] - per-cell Cascade decoration, see ARCHITECTURE.md
 */

/**
 * @typedef {Object} FlowSheet
 * @property {string} id
 * @property {string} title
 * @property {"aff"|"neg"} group
 * @property {number} order
 * @property {"flow"|"cx"} [kind] - absent/"flow" = argument grid, "cx" = cross-ex sheet
 * @property {string} [startSpeechId] - leftmost speech column shown
 * @property {(string|null)[][]} data - rows x speech-columns cell text
 * @property {Record<string, CellMeta>} meta - sparse, keyed "row,col"
 */

/**
 * @typedef {Object} FlowRound
 * @property {string} id
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} [event] - debate event; absent (legacy rounds) = "policy"
 * @property {"aff"|"neg"} [firstSide]
 * @property {Object} scouting
 * @property {FlowSheet[]} sheets
 * @property {Object} [cascade] - see ensureCascade()
 */

/**
 * A short, unique-enough id for a new object. Not cryptographically random —
 * a flow file needs stable local ids, not global uniqueness across every
 * device that ever ran Cascade.
 * @param {string} [prefix]
 * @returns {string}
 */
export function uid(prefix = "id") {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${rand}`;
}

function emptyDebater() {
    return { first: "", last: "" };
}

/** @returns {Object} a blank scouting sheet */
export function emptyScouting() {
    return {
        aff: { first: emptyDebater(), second: emptyDebater() },
        neg: { first: emptyDebater(), second: emptyDebater() },
    };
}

/**
 * @param {{title: string, group: "aff"|"neg", order: number}} input
 * @returns {FlowSheet}
 */
export function makeFlowSheet(input) {
    return {
        id: uid("sheet"),
        title: input.title,
        group: input.group,
        order: input.order,
        kind: "flow",
        data: [],
        meta: {},
    };
}

/** The pinned cross-examination sheet. order = -1 so it sorts above flow sheets.
 * @param {string} [title]
 * @returns {FlowSheet}
 */
export function makeCxFlowSheet(title = "CX") {
    return {
        id: uid("sheet"),
        title,
        group: "aff",
        order: -1,
        kind: "cx",
        data: [],
        meta: {},
    };
}

/**
 * @param {{event?: string, firstSide?: "aff"|"neg"}} [input]
 * @returns {FlowRound}
 */
export function makeFlowRound(input = {}) {
    const now = Date.now();
    const event = input.event ?? "policy";
    const firstSide = input.firstSide ?? "aff";
    const crossEx = getEvent(event).crossEx;
    return {
        id: uid("round"),
        createdAt: now,
        updatedAt: now,
        event,
        firstSide,
        scouting: emptyScouting(),
        sheets: [
            // Parliamentary has no cross-examination, so it opens with no
            // cross-ex sheet to leave empty.
            ...(crossEx ? [makeCxFlowSheet(crossEx.title)] : []),
            // The first sheet belongs to whoever speaks first, so the round
            // opens on the constructive that actually starts it.
            makeFlowSheet({ title: "1.", group: firstSide, order: 0 }),
        ],
    };
}

/**
 * Fill defaults on a round read from a file. Never mutates input. Drops the
 * legacy `deletedAt` field, which soft-deleted a round back when flows lived
 * in a database; a flow is now a file, and the filesystem owns deletion.
 * @param {FlowRound} raw
 * @returns {FlowRound}
 */
export function normalizeFlow(raw) {
    // eslint-disable-next-line no-unused-vars -- dropped on purpose, see above
    const { deletedAt: _legacyDeletedAt, ...rest } = raw;
    const r = {
        ...rest,
        event: raw.event ?? "policy",
        firstSide: raw.firstSide ?? "aff",
        scouting: raw.scouting ? { ...raw.scouting } : emptyScouting(),
        sheets: (raw.sheets ?? []).map((s) => ({
            ...s,
            kind: s.kind ?? "flow",
            data: Array.isArray(s.data) ? s.data : [],
            meta: s.meta ?? {},
        })),
    };
    const crossEx = getEvent(r.event).crossEx;
    if (crossEx && !r.sheets.some((s) => s.kind === "cx")) {
        r.sheets = [makeCxFlowSheet(crossEx.title), ...r.sheets];
    }
    return r;
}

/**
 * Total order on sheets. `reorderSheets` renumbers to contiguous integers, so
 * two peers reordering at once can produce one order value twice; resolving
 * that tie by array position would differ per peer and the two sidebars would
 * visibly disagree.
 * @param {FlowSheet} a
 * @param {FlowSheet} b
 * @returns {number}
 */
export function compareSheets(a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sheets sorted ascending by order (CX first at order -1).
 * @param {FlowRound} round
 * @returns {FlowSheet[]}
 */
export function sortedSheets(round) {
    return round.sheets.slice().sort(compareSheets);
}

/** First flow (non-CX) sheet id by order, else the first sheet, else null.
 * @param {FlowRound} round
 * @returns {string|null}
 */
export function firstFlowSheetId(round) {
    const sheets = sortedSheets(round);
    return (sheets.find((s) => s.kind !== "cx") ?? sheets[0])?.id ?? null;
}

/**
 * The contiguous slice of flow sheets between two ids, in either direction.
 * Empty when the round no longer holds one of them, which is what lets a
 * selection be stored as two ids: a sheet deleted out from under a range
 * resolves to no selection rather than a stale id in a list.
 *
 * Sorts its own copy, so the result is display order whatever the caller holds.
 * @param {readonly FlowSheet[]} sheets
 * @param {string} anchor
 * @param {string} head
 * @returns {string[]}
 */
export function sheetRangeIds(sheets, anchor, head) {
    const ordered = sheets.slice().sort(compareSheets);
    const a = ordered.findIndex((s) => s.id === anchor);
    const b = ordered.findIndex((s) => s.id === head);
    if (a === -1 || b === -1) return [];
    return ordered.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id);
}

/**
 * The ordering with the selected block slid by `delta` slots, its internal
 * order preserved. Clamped rather than guarded: a block already at the edge
 * lands where it started, and the input is returned by reference so a caller
 * can tell a real move from a no-op without comparing arrays.
 * @param {readonly string[]} orderedIds
 * @param {readonly string[]} selectedIds
 * @param {number} delta
 * @returns {readonly string[]}
 */
export function moveSheetRange(orderedIds, selectedIds, delta) {
    const selected = new Set(selectedIds);
    const block = orderedIds.filter((id) => selected.has(id));
    if (block.length === 0) return orderedIds;
    const first = orderedIds.indexOf(block[0]);
    const rest = orderedIds.filter((id) => !selected.has(id));
    const at = Math.min(Math.max(first + delta, 0), rest.length);
    if (at === first) return orderedIds;
    return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/**
 * The ordering with the selected block landed where the grabbed row did.
 *
 * Motion drags the one row under the pointer and hands back an array with
 * only that row moved, so the rest of the block has to follow it: the block
 * goes back at the grabbed row's slot, counting only the rows that are not
 * part of it, and the sheets it passed over close up behind it. Its internal
 * order comes from `selectedIds`, since the array motion hands back has the
 * grabbed row torn out of the block and dropped somewhere else in it.
 * @param {readonly string[]} orderedIds
 * @param {readonly string[]} selectedIds
 * @param {string} grabbedId
 * @returns {string[]}
 */
export function dropSheetRange(orderedIds, selectedIds, grabbedId) {
    const selected = new Set(selectedIds);
    const landing = orderedIds.indexOf(grabbedId);
    const rest = orderedIds.filter((id) => !selected.has(id));
    const block = selectedIds.filter((id) => orderedIds.includes(id));
    const at = orderedIds.slice(0, landing).filter((id) => !selected.has(id)).length;
    return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

// --- Cascade cell/sheet helpers ----------------------------------------------

/** A cell-meta key is the cell's coordinate, which is how it is looked up. */
export const CELL_KEY = /^\d+,\d+$/;

/** @param {number} row @param {number} col @returns {string} */
export function cellKey(row, col) {
    return `${row},${col}`;
}

/**
 * A cell's text, or "" when the sheet has not grown to reach it yet — a grid
 * pads to its widest row for the file format, but nothing on screen should
 * have to know that; reading past the stored rectangle is just an empty cell.
 * @param {FlowSheet} sheet
 * @param {number} row
 * @param {number} col
 * @returns {string}
 */
export function getCell(sheet, row, col) {
    return sheet.data?.[row]?.[col] ?? "";
}

/**
 * Write a cell's text, growing the sheet's data rectangle as needed. Mutates
 * `sheet` in place — callers go through `store.commit()` for undo tracking.
 * @param {FlowSheet} sheet
 * @param {number} row
 * @param {number} col
 * @param {string|null} text
 */
export function setCell(sheet, row, col, text) {
    if (!Array.isArray(sheet.data)) sheet.data = [];
    while (sheet.data.length <= row) sheet.data.push([]);
    const r = sheet.data[row];
    while (r.length <= col) r.push(null);
    r[col] = text;
}

/**
 * @param {FlowSheet} sheet
 * @param {number} row
 * @param {number} col
 * @returns {CellMeta|undefined}
 */
export function getMeta(sheet, row, col) {
    return sheet.meta?.[cellKey(row, col)];
}

/**
 * Merge a patch into a cell's metadata. A key set to `undefined`, `null`, or
 * `false` is removed rather than stored — a meta entry is decoration, and an
 * "off" flag should not linger in the file as `{bold: false}` forever. When a
 * merge empties the entry entirely, the entry itself is deleted so an idle
 * cell has no `meta` key at all.
 * @param {FlowSheet} sheet
 * @param {number} row
 * @param {number} col
 * @param {Partial<CellMeta>} patch
 */
export function setMeta(sheet, row, col, patch) {
    if (!sheet.meta) sheet.meta = {};
    const key = cellKey(row, col);
    const merged = { ...(sheet.meta[key] ?? {}), ...patch };
    for (const k of Object.keys(merged)) {
        if (merged[k] === undefined || merged[k] === null || merged[k] === false) {
            delete merged[k];
        }
    }
    if (Object.keys(merged).length === 0) {
        delete sheet.meta[key];
    } else {
        sheet.meta[key] = merged;
    }
}

/**
 * @param {FlowRound} round
 * @param {string} id
 * @returns {FlowSheet|undefined}
 */
export function sheetById(round, id) {
    return round.sheets.find((s) => s.id === id);
}

/**
 * The cells one sheet claims: its rows times its widest row, which is the
 * rectangle every consumer (grid, print view, exporter) pads it to.
 * `MAX_ROUND_CELLS` in ebbfile.js counts these.
 * @param {readonly unknown[][]} rows
 * @returns {number}
 */
export function paddedCells(rows) {
    let widest = 0;
    for (const row of rows) widest = Math.max(widest, row.length);
    return rows.length * widest;
}

/** The sheet's own group's first speech id in the round's event — the
 * default leftmost column when a sheet does not pin one explicitly. */
function firstSpeechIdForGroup(event, group) {
    const list = group === "neg" ? event.neg : event.aff;
    return list[0]?.id;
}

/**
 * The speech columns a sheet shows: the round's full alternating speech order
 * sliced from the sheet's first speech. A neg off-case sheet introduced in the
 * 1NC therefore starts at 1NC and the aff's answers land one column right.
 * CX sheets return one column per cross-ex period instead.
 * @param {FlowRound} round
 * @param {FlowSheet} sheet
 * @returns {Array<import("./events.js").SpeechDef|{id: string, name: string, short: string, side: "aff"|"neg"}>}
 */
export function sheetColumns(round, sheet) {
    const event = getEvent(round.event);
    const firstSide = round.firstSide ?? "aff";

    if (sheet.kind === "cx") {
        const periods = event.crossEx?.periods ?? [];
        const secondSide = firstSide === "aff" ? "neg" : "aff";
        return periods.map((period, i) => ({
            id: `cx${i}`,
            name: period.label,
            short: period.label,
            side: period.q === "first" ? firstSide : secondSide,
        }));
    }

    const order = speechOrder(event, firstSide);
    const startId = sheet.startSpeechId ?? firstSpeechIdForGroup(event, sheet.group);
    const idx = order.findIndex((s) => s.id === startId);
    return idx === -1 ? order : order.slice(idx);
}

/** The empty shape of `round.cascade`, created fresh so no two rounds share
 *  array/object references. */
function emptyCascade() {
    return {
        v: 1,
        links: [],
        blocks: [],
        evidence: [],
        timeline: [],
        prep: {},
        notes: "",
        prefs: {},
        // voice.js's transcript log; not in the illustrated cascade shape in
        // ARCHITECTURE.md's table but called out in prose as required here.
        transcript: [],
    };
}

/**
 * `round.cascade` holds everything Cascade adds beyond the ebb file shape.
 * Ensures every key exists — a round opened from a plain ebb file, or from an
 * older Cascade build that predates a newer key, gets the missing keys filled
 * in rather than every feature module null-checking `round.cascade.foo`
 * separately. Mutates `round` and returns the (possibly just-created) object.
 * @param {FlowRound} round
 * @returns {Object}
 */
/**
 * A predicate answering "has the speech in `columns[index]` already happened?"
 * for one sheet.
 *
 * This is the single hardest question in the app to get right, and two modules
 * ask it: the dropped-argument radar and the analytics coverage figure. They
 * each answered it themselves once, drifted apart, and reported different
 * numbers for the same round — which is worse than either number alone,
 * because a debater who catches the two disagreeing stops trusting both. It
 * lives here now so there is exactly one answer.
 *
 * Three sources, in order of how much they know:
 *   1. The round timeline — a speech with an `endedAt` demonstrably happened.
 *   2. The running clock — everything strictly before the live speech happened;
 *      the live speech itself has not finished, so nothing it has yet to answer
 *      counts as dropped.
 *   3. Neither, for a flow typed up after the round or imported from a file:
 *      how far right the sheet has been flowed. Inclusive of the furthest
 *      column, because a column somebody wrote in is a speech that occurred.
 *
 * @param {FlowRound} round
 * @param {FlowSheet} sheet
 * @param {Array<{id: string}>} columns  from `sheetColumns`
 * @param {{liveSpeechId?: string|null}} [ctx] the running speech, if any
 * @returns {(index: number) => boolean}
 */
export function happenedColumns(round, sheet, columns, { liveSpeechId = null } = {}) {
    const timeline = round?.cascade?.timeline ?? [];
    const completed = new Set(timeline.filter((t) => t?.endedAt).map((t) => t.speechId));
    const hasTimerData = timeline.length > 0 || !!liveSpeechId;

    let rightmost = -1;
    if (!hasTimerData) {
        const rows = sheet?.data ?? [];
        for (let r = 0; r < rows.length; r += 1) {
            for (let c = 0; c < columns.length; c += 1) {
                if (String(rows[r]?.[c] ?? "").trim()) rightmost = Math.max(rightmost, c);
            }
        }
    }

    const liveIdx = liveSpeechId ? columns.findIndex((c) => c.id === liveSpeechId) : -1;

    return (index) =>
        completed.has(columns[index]?.id) ||
        (liveIdx >= 0 && index < liveIdx) ||
        (!hasTimerData && index <= rightmost);
}

export function ensureCascade(round) {
    if (!round.cascade || typeof round.cascade !== "object") {
        round.cascade = emptyCascade();
        return round.cascade;
    }
    const defaults = emptyCascade();
    for (const key of Object.keys(defaults)) {
        if (!(key in round.cascade)) round.cascade[key] = defaults[key];
    }
    return round.cascade;
}
