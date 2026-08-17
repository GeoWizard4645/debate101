/**
 * The .ebb file format: a version envelope wrapping one FlowRound, written as
 * pretty-printed JSON so the file stays diffable and readable outside the app.
 *
 * Ported from ebb's src/lib/persistence/flowFile.ts. File version 3 is the
 * Handsontable-native model this app shares with ebb; a file this old is
 * refused rather than migrated, and a file newer than this build knows is
 * refused too, since this build cannot know what it would silently drop.
 *
 * Validation is strict on purpose. A round built in memory was already typed
 * by the code that built it; a file on disk can be truncated by a full disk,
 * mangled by a sync client, or hand-edited. Failing at this boundary with the
 * path to the bad value beats rendering half a round. Unknown keys are the
 * one thing NOT rejected: Cascade stores its own extensions under `cascade`
 * keys ebb has never heard of (see ARCHITECTURE.md), and normalizeFlow's
 * `...rest` spread keeps them, so a Cascade file opens in ebb with the extras
 * intact and inert, and a round-trip through ebb does not lose them. Only a
 * wrong *type* on a key both formats already know about is refused.
 */

import { EVENTS } from "./events.js";
import { normalizeFlow, uid, paddedCells, CELL_KEY } from "./model.js";

export const FLOW_FILE_VERSION = 3;

/**
 * Ceiling on the bytes a flow file takes on disk. Six of them sit in the
 * recents list a start screen might read on every launch, and a parse costs
 * several times the text in live objects, so a file this large is refused
 * before it is read back in, and a round that would serialize past it is
 * refused before it is written.
 */
export const MAX_FLOW_BYTES = 64 * 1024 * 1024;

/**
 * Ceiling on the cells one round can claim, counted per sheet as its rows
 * times its widest row (`paddedCells`) and summed. Every consumer materializes
 * that product — the grid pads to it, the print view builds a table of it,
 * the exporter walks it — and the two dimensions are independent, so a sheet
 * of one 100,000-column row followed by 100,000 single-cell rows asks for
 * 10^10 cells from under a megabyte of file. A fat real round is a few
 * hundred thousand cells.
 */
export const MAX_ROUND_CELLS = 2_000_000;

// --- Validation ---------------------------------------------------------------

function fail(path, expected) {
    throw new Error(`Invalid flow file: ${path} ${expected}`);
}

function obj(value, path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail(path, "is not an object");
    }
    return value;
}

function str(value, path) {
    if (typeof value !== "string") fail(path, "is not a string");
    return value;
}

/** Absent and null both mean "unset"; anything else must be the right type. */
function optional(value) {
    return value === undefined || value === null;
}

function optStr(value, path) {
    if (!optional(value) && typeof value !== "string") fail(path, "is not a string");
}

function optBool(value, path) {
    if (!optional(value) && typeof value !== "boolean") fail(path, "is not a boolean");
}

function finiteNum(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "is not a number");
    return value;
}

function checkDebater(value, path) {
    const d = obj(value, path);
    str(d.first, `${path}.first`);
    str(d.last, `${path}.last`);
}

function checkScouting(value, path) {
    const sc = obj(value, path);
    for (const side of ["aff", "neg"]) {
        const team = obj(sc[side], `${path}.${side}`);
        checkDebater(team.first, `${path}.${side}.first`);
        checkDebater(team.second, `${path}.${side}.second`);
    }
    for (const key of ["affSchool", "negSchool", "tournament", "round", "flight", "date", "judge"]) {
        optStr(sc[key], `${path}.${key}`);
    }
    if (!optional(sc.decision)) {
        const d = obj(sc.decision, `${path}.decision`);
        if (!optional(d.vote) && d.vote !== "aff" && d.vote !== "neg") {
            fail(`${path}.decision.vote`, 'is not "aff" or "neg"');
        }
        optStr(d.rfd, `${path}.decision.rfd`);
        if (!optional(d.peerNotes)) {
            // One entry per peer, each that peer's own notes. A hand edit that
            // put something else in here would reach the RFD preview.
            const notes = obj(d.peerNotes, `${path}.decision.peerNotes`);
            for (const [endpointId, note] of Object.entries(notes)) {
                optStr(note, `${path}.decision.peerNotes.${endpointId}`);
            }
        }
    }
}

function checkCellMeta(value, path) {
    const m = obj(value, path);
    optBool(m.bold, `${path}.bold`);
    optBool(m.highlight, `${path}.highlight`);
    optBool(m.card, `${path}.card`);
    optBool(m.group, `${path}.group`);
    // Cascade addition to the shared ebb schema (renders struck through and
    // dimmed in grid.js), but it is a known top-level key per ARCHITECTURE.md's
    // file example, so a wrong type on it is still refused, not waved through
    // the way `m.cascade` below is.
    optBool(m.kicked, `${path}.kicked`);
    if (!optional(m.answers)) {
        const a = obj(m.answers, `${path}.answers`);
        str(a.sheetId, `${path}.answers.sheetId`);
        finiteNum(a.row, `${path}.answers.row`);
        finiteNum(a.col, `${path}.answers.col`);
    }
    if (!optional(m.source)) {
        const s = obj(m.source, `${path}.source`);
        str(s.app, `${path}.source.app`);
        str(s.token, `${path}.source.token`);
        str(s.key, `${path}.source.key`);
        optStr(s.title, `${path}.source.title`);
    }
    // `m.cascade` (per-cell Cascade decoration) is deliberately left
    // unvalidated: it is Cascade's own namespaced extension, opaque to this
    // ebb-compatible schema, and must survive a round-trip through ebb intact.
}

/** Validate one sheet, returning the cells the grid pads it to. */
function checkSheet(value, path) {
    const s = obj(value, path);
    str(s.id, `${path}.id`);
    str(s.title, `${path}.title`);
    if (s.group !== "aff" && s.group !== "neg") fail(`${path}.group`, 'is not "aff" or "neg"');
    finiteNum(s.order, `${path}.order`);
    if (!optional(s.kind) && s.kind !== "flow" && s.kind !== "cx") {
        fail(`${path}.kind`, 'is not "flow" or "cx"');
    }
    optStr(s.startSpeechId, `${path}.startSpeechId`);

    if (!Array.isArray(s.data)) fail(`${path}.data`, "is not an array");
    s.data.forEach((row, r) => {
        if (!Array.isArray(row)) fail(`${path}.data[${r}]`, "is not a row");
        row.forEach((cell, c) => {
            if (cell !== null && typeof cell !== "string") {
                fail(`${path}.data[${r}][${c}]`, "is not text or null");
            }
        });
    });

    // Sparse and optional: an older sheet may predate cell metadata entirely.
    // A key reaches the grid as a row and a column, and a decoration can sit on
    // a padded cell past the stored rows, so the form is checked and the range
    // is not.
    if (!optional(s.meta)) {
        const meta = obj(s.meta, `${path}.meta`);
        for (const key of Object.keys(meta)) {
            if (!CELL_KEY.test(key)) fail(`${path}.meta["${key}"]`, 'is not a "row,col" cell');
            checkCellMeta(meta[key], `${path}.meta["${key}"]`);
        }
    }
    return paddedCells(s.data);
}

/**
 * Validate a parsed round, throwing with the path to the first bad value.
 * `round.cascade`, if present, is not inspected here — it belongs to Cascade,
 * not to the shared ebb schema, and is accepted whatever shape it is in.
 * @param {unknown} value
 * @param {string} path
 * @returns {import("./model.js").FlowRound}
 */
export function checkRound(value, path) {
    const r = obj(value, path);
    str(r.id, `${path}.id`);
    finiteNum(r.createdAt, `${path}.createdAt`);
    finiteNum(r.updatedAt, `${path}.updatedAt`);
    if (!optional(r.event)) {
        const event = str(r.event, `${path}.event`);
        // `in` walks the prototype chain, so "constructor" would pass and name
        // no event at all.
        if (!Object.hasOwn(EVENTS, event)) fail(`${path}.event`, "is not a known debate event");
    }
    if (!optional(r.firstSide) && r.firstSide !== "aff" && r.firstSide !== "neg") {
        fail(`${path}.firstSide`, 'is not "aff" or "neg"');
    }
    checkScouting(r.scouting, `${path}.scouting`);
    if (!Array.isArray(r.sheets)) fail(`${path}.sheets`, "is not an array");
    let cells = 0;
    r.sheets.forEach((s, i) => {
        cells += checkSheet(s, `${path}.sheets[${i}]`);
    });
    if (cells > MAX_ROUND_CELLS) {
        fail(`${path}.sheets`, `hold more than ${MAX_ROUND_CELLS} cells`);
    }
    return value;
}

/**
 * The bytes one string takes on disk, exactly (not the character count — a
 * character can be up to three UTF-8 bytes, and the shell refuses a file by
 * the bytes on disk).
 * @param {string} text
 * @returns {number}
 */
export function utf8Bytes(text) {
    let bytes = text.length;
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code < 0x80) continue;
        bytes += code < 0x800 || (code >= 0xd800 && code < 0xe000) ? 1 : 2;
    }
    return bytes;
}

/** What the indent, separators, and newline of one line of pretty-printed
 *  JSON cost on top of the value sitting on it, counted high on purpose. */
const FILE_LINE = 16;

/**
 * What one value costs the flow file: its own JSON in UTF-8, plus a line's
 * worth of structure for every line it spans. Counted rather than encoded —
 * a scalar is never built in its indented form to answer this, since every
 * cell of every sheet would otherwise be re-stringified to price it.
 * @param {unknown} value
 * @returns {number}
 */
export function fileBytes(value) {
    const text =
        value !== null && typeof value === "object"
            ? (JSON.stringify(value, null, 2) ?? "null")
            : (JSON.stringify(value) ?? "null");
    let bytes = text.length;
    let lines = 1;
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            if (code === 10) lines += 1;
            continue;
        }
        bytes += code < 0x800 ? 1 : 2;
    }
    return bytes + lines * FILE_LINE;
}

// --- Cascade strict-mode stripping --------------------------------------------

/**
 * A deep copy of `round` with every Cascade extension removed: `round.cascade`
 * and every `meta[k].cascade`. Used by `serializeFlow(round, {strict: true})`
 * for the "Export .ebb (strict)" path, which trades Cascade's extra features
 * for a file that reads as a plain ebb file to the byte. Never mutates the
 * input — the live round keeps its Cascade data regardless of how it is
 * exported.
 */
function stripCascade(round) {
    const clone = structuredClone(round);
    delete clone.cascade;
    for (const sheet of clone.sheets ?? []) {
        if (!sheet.meta) continue;
        for (const cell of Object.values(sheet.meta)) {
            if (cell && typeof cell === "object" && "cascade" in cell) {
                delete cell.cascade;
            }
        }
    }
    return clone;
}

// --- Writing -------------------------------------------------------------------

/**
 * Serialize a round as .ebb file text.
 *
 * A file this parser cannot read back is a round the debater loses for good,
 * so the write validates first, the same way the read does. `strict` produces
 * the interop export: a deep-stripped copy with every Cascade namespace gone,
 * so the bytes on disk are indistinguishable from a file ebb itself wrote.
 * @param {import("./model.js").FlowRound} round
 * @param {{strict?: boolean}} [options]
 * @returns {string}
 */
export function serializeFlow(round, { strict = false } = {}) {
    const target = strict ? stripCascade(round) : round;
    checkRound(target, "round");
    const text = JSON.stringify({ version: FLOW_FILE_VERSION, round: target }, null, 2) + "\n";
    if (utf8Bytes(text) > MAX_FLOW_BYTES) {
        fail("round", `is longer than the ${MAX_FLOW_BYTES} bytes a flow file holds`);
    }
    return text;
}

// --- Reading ---------------------------------------------------------------

function parseEnvelope(text) {
    // A char-length check is a safe, cheap pre-filter: UTF-8 bytes are never
    // fewer than characters, so text already over the byte cap in characters
    // alone is definitely over it in bytes, and this check runs before the
    // (much costlier) JSON.parse rather than after it.
    if (typeof text !== "string" || text.length > MAX_FLOW_BYTES) {
        throw new Error("Not a flow file: it is too large to be one");
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("Not a flow file: the contents are not valid JSON");
    }
    const envelope = obj(parsed, "the file");
    const version = finiteNum(envelope.version, "the file version");
    if (version > FLOW_FILE_VERSION) {
        throw new Error(
            `This flow was written by a newer version of the app (file version ${version}). Update Cascade to open it.`,
        );
    }
    if (version < FLOW_FILE_VERSION) {
        throw new Error(
            `Flow file version ${version} is from a retired format and cannot be opened.`,
        );
    }
    return envelope;
}

/**
 * Parse .ebb file text into the round it holds, preserving its identity.
 * Opening a file is not importing one: the path is the identity now, so the
 * round's own id, createdAt, and history survive the round trip.
 * @param {string} text
 * @returns {import("./model.js").FlowRound}
 */
export function parseFlowFile(text) {
    const envelope = parseEnvelope(text);
    if (envelope.kind === "backup") {
        throw new Error("That is a multi-flow backup, not a single flow.");
    }
    return normalizeFlow(checkRound(envelope.round, "round"));
}

/**
 * Parse a legacy export — either a single `{version, round}` or a
 * `{version, kind:"backup", rounds}` — into rounds with fresh identities.
 * These files were snapshots rather than documents, so materializing one into
 * the app mints a new identity per round the way importing always did.
 * @param {string} text
 * @returns {import("./model.js").FlowRound[]}
 */
export function parseLegacyExport(text) {
    const envelope = parseEnvelope(text);
    const backup = envelope.kind === "backup";
    if (backup && !Array.isArray(envelope.rounds)) fail("rounds", "is not an array");
    const raw = backup ? envelope.rounds : [envelope.round];

    const now = Date.now();
    return raw.map((r, i) => ({
        ...normalizeFlow(checkRound(r, backup ? `rounds[${i}]` : "round")),
        id: uid("round"),
        createdAt: now,
        updatedAt: now,
    }));
}

/**
 * A cheap sniff for "is this plausibly a flow file", for a drop zone deciding
 * how to route a dropped file before committing to a full parse. Never
 * throws — an arbitrary dropped file is expected input, not an error.
 * @param {string} text
 * @returns {boolean}
 */
export function isFlowFileText(text) {
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_FLOW_BYTES) {
        return false;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return false;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    if (typeof parsed.version !== "number") return false;
    if (parsed.kind === "backup") return Array.isArray(parsed.rounds);
    return typeof parsed.round === "object" && parsed.round !== null;
}

/** Strip characters a filesystem would reject or that would fight a shell,
 *  and cap the length well under any OS's path-component limit. */
function sanitizeFilename(name) {
    return name
        .replace(/[/\\:*?"<>|]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
}

/**
 * A human filename for a save dialog, built from scouting so a debater never
 * has to type one, e.g. "Harvard R3 — Aff vs Bronx BC.ebb". Whichever school
 * field is filled names the opponent: a debater's own school is usually the
 * one left blank on their own flow, so the name reads as "Aff vs Their
 * School" rather than repeating a school every flow in the folder already
 * belongs to. Falls back to the round's date when scouting is empty — a
 * debate happens without a filled-in info sheet too, just not most of them.
 * @param {import("./model.js").FlowRound} round
 * @returns {string}
 */
export function suggestFilename(round) {
    const sc = round.scouting ?? {};
    const bits = [];
    if (sc.tournament) bits.push(sc.tournament.trim());
    if (sc.round) {
        const r = sc.round.trim();
        bits.push(/^r(ound)?\s*\d/i.test(r) ? r : `R${r}`);
    }
    const head = bits.join(" ");

    const affSchool = (sc.affSchool ?? "").trim();
    const negSchool = (sc.negSchool ?? "").trim();
    let matchup = "";
    if (affSchool && negSchool) {
        matchup = `Aff vs ${negSchool}`;
    } else if (negSchool) {
        matchup = `Aff vs ${negSchool}`;
    } else if (affSchool) {
        matchup = `Neg vs ${affSchool}`;
    }

    const name =
        [head, matchup].filter(Boolean).join(" — ") ||
        `Flow ${new Date(round.createdAt ?? Date.now()).toISOString().slice(0, 10)}`;
    return `${sanitizeFilename(name)}.ebb`;
}
