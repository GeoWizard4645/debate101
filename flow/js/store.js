/**
 * Cascade — the state store: single mutable round, undo/redo history, and
 * persistence (autosave to IndexedDB, native file save/open via the File
 * System Access API). Every module that changes the round goes through
 * `store.commit()` so undo, autosave, and the dirty flag stay correct for
 * free — a debater who fat-fingers a cell mid-round should never lose a flow
 * because some feature module bypassed the store to poke `round` directly.
 */

import { bus } from "./bus.js";
import { download } from "./dom.js";
import {
    makeFlowRound,
    normalizeFlow,
    sortedSheets,
    firstFlowSheetId,
    ensureCascade,
    sheetById,
} from "./model.js";
import { serializeFlow, parseFlowFile, parseLegacyExport, suggestFilename } from "./ebbfile.js";

// Undo snapshots are structural clones of the whole round. A round is small
// (a few hundred KB even for a long tournament flow), so a full clone per
// commit is far simpler — and far less bug-prone — than a diff/patch engine,
// and 200 entries of a small object is still cheap.
const UNDO_CAP = 200;

// Keystrokes inside one cell edit should collapse into a single undo entry.
// 900ms is longer than the gap between keystrokes at speed but shorter than
// the pause when a debater moves to a different thought.
const COALESCE_MS = 900;

const AUTOSAVE_MS = 2000;

const DB_NAME = "cascade-flows";
const DB_VERSION = 1;
const STORE_ROUNDS = "rounds";
const STORE_HANDLES = "handles";
const STORE_KV = "kv";

// localStorage is the private-browsing / IndexedDB-unavailable fallback.
// Browsers cap localStorage around 5-10MB; stay well under that so a large
// flow doesn't throw QuotaExceededError mid-round.
const LS_BUDGET_CHARS = 4_500_000;
const LS_PREFIX = "cascade.ls.";
const LS_ROUND_INDEX_KEY = `${LS_PREFIX}rounds.index`;

// --- module state -----------------------------------------------------
// A round always exists (never null) so grid.js and friends can mount before
// main.js decides whether to restore an autosave over this fresh one.

let round = normalizeFlow(makeFlowRound());
ensureCascade(round);
let activeSheetId = firstFlowSheetId(round);
let selection = { row: 0, col: 0, anchorRow: 0, anchorCol: 0 };
let dirty = false;
let fileName = null;
let savedAt = null;
/** @type {FileSystemFileHandle | null} */
let fileHandle = null;

let undoStack = []; // [{ round, label }], oldest first
let redoStack = [];
let lastCommit = null; // { key, at } — drives the coalescing window

// --- tiny persistence layer --------------------------------------------
// dbPut/dbGet/dbGetAll/dbDelete are the only functions the rest of the file
// talks to; they hide whether the backend is IndexedDB or localStorage so a
// private-browsing tab degrades without a single `if` at every call site.

let dbPromise = null;
let idbBroken = false; // sticky: once IndexedDB misbehaves, stop retrying it this session

function hasIndexedDB() {
    return !idbBroken && typeof indexedDB !== "undefined";
}

function openDatabase() {
    if (!hasIndexedDB()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        let req;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
            idbBroken = true;
            resolve(null);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_ROUNDS)) db.createObjectStore(STORE_ROUNDS, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES, { keyPath: "id" });
            if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            idbBroken = true;
            resolve(null);
        };
    });
    return dbPromise;
}

function idbRequest(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, mode);
            const req = fn(tx.objectStore(storeName));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (err) {
            reject(err);
        }
    });
}

function hasLocalStorage() {
    return typeof localStorage !== "undefined";
}

function lsKey(storeName, key) {
    return `${LS_PREFIX}${storeName}.${key}`;
}

function lsReadIndex() {
    if (!hasLocalStorage()) return [];
    try {
        return JSON.parse(localStorage.getItem(LS_ROUND_INDEX_KEY) || "[]");
    } catch {
        return [];
    }
}

function lsWriteIndex(ids) {
    lsSafeSet(LS_ROUND_INDEX_KEY, JSON.stringify(ids));
}

/** Never throws: a quota error or a sandboxed localStorage just silently drops the write. */
function lsSafeSet(key, value) {
    if (!hasLocalStorage()) return false;
    if (value.length > LS_BUDGET_CHARS) {
        console.warn(`[store] skipping localStorage write for "${key}": exceeds size budget`);
        return false;
    }
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (err) {
        console.warn(`[store] localStorage write failed for "${key}"`, err);
        return false;
    }
}

function lsSafeGet(key) {
    if (!hasLocalStorage()) return undefined;
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : undefined;
    } catch {
        return undefined;
    }
}

/** Put a value; falls back to localStorage; never throws. FileSystemFileHandles cannot survive that fallback. */
async function dbPut(storeName, value) {
    const db = await openDatabase();
    if (db) {
        try {
            await idbRequest(db, storeName, "readwrite", (store) => store.put(value));
            return true;
        } catch (err) {
            console.warn(`[store] IndexedDB put failed on "${storeName}", falling back to localStorage`, err);
            idbBroken = true;
        }
    }
    if (storeName === STORE_HANDLES) return false; // not JSON-serializable, no safe fallback
    if (storeName === STORE_KV) return lsSafeSet(lsKey(storeName, value.key), JSON.stringify(value));
    const ok = lsSafeSet(lsKey(storeName, value.id), JSON.stringify(value));
    if (ok) {
        const ids = lsReadIndex();
        if (!ids.includes(value.id)) {
            ids.push(value.id);
            lsWriteIndex(ids);
        }
    }
    return ok;
}

async function dbGet(storeName, key) {
    const db = await openDatabase();
    if (db) {
        try {
            return await idbRequest(db, storeName, "readonly", (store) => store.get(key));
        } catch (err) {
            console.warn(`[store] IndexedDB get failed on "${storeName}", falling back to localStorage`, err);
            idbBroken = true;
        }
    }
    if (storeName === STORE_HANDLES) return undefined;
    return lsSafeGet(lsKey(storeName, key));
}

async function dbGetAll(storeName) {
    const db = await openDatabase();
    if (db) {
        try {
            return await idbRequest(db, storeName, "readonly", (store) => store.getAll());
        } catch (err) {
            console.warn(`[store] IndexedDB getAll failed on "${storeName}", falling back to localStorage`, err);
            idbBroken = true;
        }
    }
    if (storeName === STORE_HANDLES) return [];
    const out = [];
    for (const id of lsReadIndex()) {
        const rec = lsSafeGet(lsKey(storeName, id));
        if (rec) out.push(rec);
    }
    return out;
}

// --- round persistence ---------------------------------------------------

function buildRecord() {
    return {
        id: round.id,
        name: fileName || suggestFilename(round),
        updatedAt: round.updatedAt,
        event: round.event,
        tournament: round.scouting?.tournament || "",
        round,
    };
}

/** Write the current round to disk (IDB/localStorage) right now, and remember it as the last-open round. */
async function persistRoundNow() {
    await dbPut(STORE_ROUNDS, buildRecord());
    await dbPut(STORE_KV, { key: "lastOpenId", value: round.id });
}

const scheduleAutosave = (() => {
    let t = null;
    const fn = () => {
        t = null;
        persistRoundNow().catch((err) => console.error("[store] autosave failed", err));
    };
    const debounced = () => {
        clearTimeout(t);
        t = setTimeout(fn, AUTOSAVE_MS);
    };
    debounced.flush = () => {
        clearTimeout(t);
        t = null;
        fn();
    };
    return debounced;
})();

// Flush on the two moments a tab can disappear without warning: it goes to
// the background (mobile OSes may just kill it) or it's actually unloading.
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) scheduleAutosave.flush();
    });
}
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => scheduleAutosave.flush());
    window.addEventListener("beforeunload", (e) => {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = "";
    });
}

// --- internal helpers ------------------------------------------------

function isValidSheetId(id) {
    return sortedSheets(round).some((s) => s.id === id);
}

function getState() {
    return {
        round,
        activeSheetId,
        activeSheet: sheetById(round, activeSheetId) || null,
        selection,
        dirty,
        fileName,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        cascade: ensureCascade(round),
    };
}

async function ensureWritePermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return true; // older impl: assume granted
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return true;
    if (typeof handle.requestPermission === "function") {
        perm = await handle.requestPermission({ mode: "readwrite" });
    }
    return perm === "granted";
}

// --- writing -----------------------------------------------------------

/**
 * Apply a mutation to the round and push an undo entry.
 * @param {(round: object) => void} mutator  mutate the draft in place
 * @param {{label?: string, coalesce?: string|null, silent?: boolean}} [opts]
 */
function commit(mutator, opts = {}) {
    const { label = null, coalesce = null, silent = false } = opts;
    const now = Date.now();
    const canCoalesce =
        coalesce != null && lastCommit != null && lastCommit.key === coalesce && now - lastCommit.at < COALESCE_MS;

    if (!canCoalesce) {
        // Snapshot BEFORE mutating: undo restores the round exactly as it was
        // when this commit (or coalescing run) began.
        undoStack.push({ round: structuredClone(round), label });
        if (undoStack.length > UNDO_CAP) undoStack.shift();
        redoStack = [];
    }
    lastCommit = coalesce != null ? { key: coalesce, at: now } : null;

    mutator(round);
    round.updatedAt = Date.now();
    dirty = true;
    scheduleAutosave();
    if (!silent) bus.emit("round:change", getState());
    return round;
}

function undo() {
    if (!undoStack.length) return false;
    const entry = undoStack.pop();
    redoStack.push({ round: structuredClone(round), label: entry.label });
    if (redoStack.length > UNDO_CAP) redoStack.shift();
    round = entry.round;
    lastCommit = null; // an undo boundary must never coalesce with what preceded it

    const prevActiveSheetId = activeSheetId;
    if (!isValidSheetId(activeSheetId)) activeSheetId = firstFlowSheetId(round);

    dirty = true;
    scheduleAutosave();
    bus.emit("round:change", getState());
    if (activeSheetId !== prevActiveSheetId) bus.emit("sheet:change", getState());
    return true;
}

function redo() {
    if (!redoStack.length) return false;
    const entry = redoStack.pop();
    undoStack.push({ round: structuredClone(round), label: entry.label });
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    round = entry.round;
    lastCommit = null;

    const prevActiveSheetId = activeSheetId;
    if (!isValidSheetId(activeSheetId)) activeSheetId = firstFlowSheetId(round);

    dirty = true;
    scheduleAutosave();
    bus.emit("round:change", getState());
    if (activeSheetId !== prevActiveSheetId) bus.emit("sheet:change", getState());
    return true;
}

/**
 * Replace the whole round wholesale — open / new / import all funnel here so
 * undo history, selection, and the active sheet always reset consistently.
 * @param {object} nextRound
 * @param {{fileName?: string|null, markClean?: boolean}} [opts]
 */
function setRound(nextRound, opts = {}) {
    const { fileName: nextFileName = null, markClean = true } = opts;
    round = normalizeFlow(nextRound);
    ensureCascade(round);
    activeSheetId = firstFlowSheetId(round);
    selection = { row: 0, col: 0, anchorRow: 0, anchorCol: 0 };
    undoStack = [];
    redoStack = [];
    lastCommit = null;
    fileName = nextFileName;
    dirty = !markClean;
    savedAt = markClean ? Date.now() : savedAt;

    persistRoundNow().catch((err) => console.error("[store] persisting opened round failed", err));

    bus.emit("round:change", getState());
    bus.emit("sheet:change", getState());
    bus.emit("selection:change", getState());
    bus.emit("file:opened", { fileName, round });
    bus.emit("save:state", { dirty, fileName, savedAt });
}

/** @param {string} id */
function setActiveSheet(id) {
    if (id === activeSheetId) return;
    if (!isValidSheetId(id)) return; // ignore stale ids from a torn-down panel
    activeSheetId = id;
    selection = { row: 0, col: 0, anchorRow: 0, anchorCol: 0 };
    bus.emit("sheet:change", getState());
    bus.emit("selection:change", getState());
}

/** @param {{row?: number, col?: number, anchorRow?: number, anchorCol?: number}} sel */
function setSelection(sel) {
    selection = { ...selection, ...sel };
    bus.emit("selection:change", getState());
}

/**
 * @param {string|null} [name]  omit to keep the current fileName
 * @param {object} [extra]  merged into the save:state payload (e.g. {via: "download"})
 */
function markSaved(name, extra = {}) {
    dirty = false;
    if (name !== undefined) fileName = name;
    savedAt = Date.now();
    bus.emit("save:state", { dirty, fileName, savedAt, ...extra });
    persistRoundNow().catch((err) => console.error("[store] persist after save failed", err));
}

// --- file system access --------------------------------------------------

/** Write to the current handle if one exists (asking permission if needed); otherwise behaves like saveAs(). */
async function save() {
    if (fileHandle) {
        try {
            const granted = await ensureWritePermission(fileHandle);
            if (granted) {
                const writable = await fileHandle.createWritable();
                await writable.write(serializeFlow(round));
                await writable.close();
                markSaved(fileHandle.name, { via: "handle" });
                return true;
            }
        } catch (err) {
            console.warn("[store] write to existing handle failed, falling back to Save As", err);
        }
    }
    return saveAs();
}

/** Always prompts (native picker when available); falls back to a browser download. */
async function saveAs() {
    if (typeof window !== "undefined" && window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: suggestFilename(round),
                types: [{ description: "Debate flow", accept: { "application/json": [".ebb"] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(serializeFlow(round));
            await writable.close();
            fileHandle = handle;
            await dbPut(STORE_HANDLES, { id: round.id, handle }).catch(() => {});
            markSaved(handle.name, { via: "handle" });
            return true;
        } catch (err) {
            if (err && err.name === "AbortError") return false; // user cancelled the picker
            console.warn("[store] showSaveFilePicker failed, falling back to download", err);
        }
    }
    const name = suggestFilename(round);
    download(name, serializeFlow(round), "application/json");
    // Autosave remains the safety net; the download is a point-in-time copy, not a live handle.
    markSaved(name, { via: "download" });
    return true;
}

/** Read a File/Blob (drag-drop, upload flow, or from open()) into the store. */
async function openFile(file, opts = {}) {
    const { handle = null } = opts;
    let text;
    try {
        text = await file.text();
    } catch (err) {
        bus.emit("file:error", { message: `Could not read "${file.name}": ${err.message}` });
        return false;
    }

    let nextRound;
    try {
        nextRound = parseFlowFile(text);
    } catch (primaryErr) {
        // Not a v3 .ebb file (wrong version/shape) — try the legacy multi-round export shape
        // before giving up, so old backups still open.
        try {
            const rounds = parseLegacyExport(text);
            if (!rounds.length) throw primaryErr;
            const [first, ...rest] = rounds;
            nextRound = first;
            if (rest.length) bus.emit("file:multi", rest);
        } catch {
            bus.emit("file:error", { message: primaryErr.message || String(primaryErr) });
            return false;
        }
    }

    setRound(nextRound, { fileName: file.name, markClean: true });
    fileHandle = handle;
    if (handle) await dbPut(STORE_HANDLES, { id: round.id, handle }).catch(() => {});
    return true;
}

function openWithInputFallback() {
    return new Promise((resolve) => {
        if (typeof document === "undefined") {
            resolve(false);
            return;
        }
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".ebb,.json,application/json";
        input.style.display = "none";
        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            input.remove();
            resolve(val);
        };
        input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            finish(file ? await openFile(file) : false);
        });
        // Newer browsers fire "cancel" when the picker is dismissed without a choice.
        input.addEventListener("cancel", () => finish(false));
        document.body.append(input);
        input.click();
    });
}

/** Native picker (.ebb/.json) when available, else a synthetic file input. */
async function open() {
    if (typeof window !== "undefined" && window.showOpenFilePicker) {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: "Debate flow", accept: { "application/json": [".ebb", ".json"] } }],
            });
            const file = await handle.getFile();
            return openFile(file, { handle });
        } catch (err) {
            if (err && err.name === "AbortError") return false;
            console.warn("[store] showOpenFilePicker failed, falling back to <input type=file>", err);
        }
    }
    return openWithInputFallback();
}

/** @param {{event?: string, firstSide?: string}} [opts] */
function newRound(opts = {}) {
    fileHandle = null;
    const fresh = makeFlowRound(opts);
    setRound(fresh, { fileName: null, markClean: true });
    return fresh;
}

// --- recents / restore -----------------------------------------------

/** Newest 12 autosaved rounds, for a "recent flows" start-screen list. */
async function recents() {
    const all = await dbGetAll(STORE_ROUNDS);
    return all
        .slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 12)
        .map(({ id, name, updatedAt, event, tournament }) => ({ id, name, updatedAt, event, tournament }));
}

/** @param {string} id */
async function restoreRecent(id) {
    const record = await dbGet(STORE_ROUNDS, id);
    if (!record || !record.round) return false;
    setRound(record.round, { fileName: record.name || null, markClean: true });

    // Re-attach a remembered File System handle so Mod+S keeps writing to the
    // same file across a reload; permission is re-requested lazily on save().
    const rec = await dbGet(STORE_HANDLES, id).catch(() => undefined);
    fileHandle = rec && rec.handle ? rec.handle : null;
    return true;
}

/** The most recently autosaved round's id, so main.js can offer to restore it on boot. */
async function lastOpenId() {
    const rec = await dbGet(STORE_KV, "lastOpenId");
    return rec ? rec.value : null;
}

// --- subscription -------------------------------------------------------

const CHANGE_TOPICS = ["round:change", "sheet:change", "selection:change", "save:state", "file:opened"];

/** fn(state) fires on any change topic the store emits; returns an unsubscribe. */
function subscribe(fn) {
    const unsubs = CHANGE_TOPICS.map((topic) => bus.on(topic, () => fn(getState())));
    return () => unsubs.forEach((un) => un());
}

// --- public surface -------------------------------------------------

export const store = {
    get round() {
        return round;
    },
    get activeSheetId() {
        return activeSheetId;
    },
    get activeSheet() {
        return sheetById(round, activeSheetId) || null;
    },
    get selection() {
        return selection;
    },
    get dirty() {
        return dirty;
    },
    get fileName() {
        return fileName;
    },
    get canUndo() {
        return undoStack.length > 0;
    },
    get canRedo() {
        return redoStack.length > 0;
    },
    get cascade() {
        return ensureCascade(round);
    },

    commit,
    undo,
    redo,
    setRound,
    setActiveSheet,
    setSelection,
    markSaved,

    save,
    saveAs,
    open,
    openFile,
    newRound,
    recents,
    restoreRecent,
    lastOpenId,

    subscribe,
};

export default store;
