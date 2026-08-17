/**
 * Cascade — import / upload / export.
 *
 * This is the only door between a Cascade flow and the rest of the world:
 * opening files a debater already has (ebb flows, spreadsheets, plain notes),
 * and getting a flow back out (native/interop .ebb, .json, .csv, Markdown,
 * plain text, a cite sheet, a printable PDF, and a full autosave backup).
 * It must work identically on the web build and the Electron shell, which is
 * why every file read goes through the File/Blob API instead of a filesystem
 * path — the web version never gets one.
 */

import {
    makeFlowRound,
    makeFlowSheet,
    sortedSheets,
    sheetColumns,
    getCell,
} from "./model.js";
import {
    FLOW_FILE_VERSION,
    serializeFlow,
    parseFlowFile,
    parseLegacyExport,
    isFlowFileText,
    suggestFilename,
} from "./ebbfile.js";
import { store } from "./store.js";
import { ui } from "./ui.js";
import { registerAll, run as runCommand } from "./registry.js";
import { el, $, clear, download } from "./dom.js";

/** Extensions Cascade knows how to open, in the order they're offered to a picker. */
const ACCEPTED_EXTENSIONS = [".ebb", ".json", ".csv", ".tsv", ".txt", ".md", ".docx"];

// --- Drag-and-drop overlay ---------------------------------------------------
//
// `dragenter`/`dragleave` fire once per DOM element the pointer crosses, not
// once for the window, so a naive show-on-enter/hide-on-leave handler flickers
// every time the drag crosses a child element. A depth counter fixes that:
// show at 0->1, hide at 1->0, ignore everything in between.

let dragDepth = 0;
let overlayEl = null;

function hasFiles(e) {
    return !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
}

/** Lazily build the full-window drop overlay. Built once, toggled with display. */
function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = el(
        "div#cascade-drop-overlay",
        {
            role: "presentation",
            "aria-hidden": "true",
            style: {
                display: "none",
                position: "fixed",
                inset: "0",
                zIndex: "9999",
                background: "rgba(5, 28, 44, 0.86)",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
            },
        },
        el(
            "div.cascade-drop-card",
            {
                style: {
                    border: "3px dashed #38bdf8",
                    borderRadius: "16px",
                    padding: "48px 64px",
                    textAlign: "center",
                    color: "#f8fafc",
                    fontFamily: "Inter, system-ui, sans-serif",
                },
            },
            el("div", { style: { fontSize: "28px", fontWeight: "700" }, text: "Drop your flow here" }),
            el("div", {
                style: { marginTop: "10px", fontSize: "14px", opacity: "0.75" },
                text: `Accepts ${ACCEPTED_EXTENSIONS.join(", ")}`,
            }),
        ),
    );
    document.body.append(overlayEl);
    return overlayEl;
}

function showOverlay() {
    const node = ensureOverlay();
    node.style.display = "flex";
}

function hideOverlay() {
    if (overlayEl) overlayEl.style.display = "none";
}

/** Wire the window-level drag/drop handlers that back the full-window overlay. */
function initDragDrop() {
    window.addEventListener("dragenter", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        showOverlay();
    });
    window.addEventListener("dragover", (e) => {
        // Without preventDefault the browser refuses the drop entirely and
        // opens the file in a new tab instead.
        if (!hasFiles(e)) return;
        e.preventDefault();
    });
    window.addEventListener("dragleave", (e) => {
        if (!hasFiles(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hideOverlay();
    });
    window.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        hideOverlay();
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length) importFiles(files);
    });
}

/**
 * Attach to the shell-provided start-screen upload zone, if it exists.
 * The shell agent owns index.html and may or may not have shipped these
 * elements yet, so every lookup is defensive: a missing element is a no-op,
 * never a thrown error.
 */
function wireStartScreen() {
    const zone = $("#start-dropzone");
    const input = $("#start-file-input");
    if (zone) {
        zone.addEventListener("dragover", (e) => e.preventDefault());
        zone.addEventListener("drop", (e) => {
            e.preventDefault();
            const files = [...(e.dataTransfer?.files ?? [])];
            if (files.length) importFiles(files);
        });
        // A click on the zone should behave like clicking the paired file
        // input, when there is one — but only if it's not already a <label>
        // wired to the input by the shell markup.
        if (input) zone.addEventListener("click", () => input.click());
    }
    if (input) {
        input.addEventListener("change", () => {
            const files = [...(input.files ?? [])];
            input.value = ""; // allow re-selecting the same file next time
            if (files.length) importFiles(files);
        });
    }
}

// --- File-type dispatch -------------------------------------------------------

function extOf(name) {
    const m = /\.[^./]+$/.exec(name || "");
    return m ? m[0].toLowerCase() : "";
}

function truncate(s, n) {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Import a batch of dropped/selected/picked files. Each is handled
 * independently so one bad file in a pile of ten doesn't block the other
 * nine; a summary toast reports the outcome once the whole batch settles.
 * @param {FileList|File[]} fileList
 */
export async function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const results = [];
    for (const file of files) {
        try {
            const outcome = await importOneFile(file);
            results.push({ file, ...outcome });
        } catch (err) {
            if (err?.unsupportedType) {
                // Wrong kind of file entirely — a quick toast is enough, a
                // modal would be overkill for "that's a .png".
                ui.toast(err.message, { type: "error" });
            } else {
                await showParseError(file.name, err);
            }
            results.push({ file, status: "error", detail: err });
        }
    }
    reportImportSummary(results);
}

async function importOneFile(file) {
    const ext = extOf(file.name);
    if (ext === ".docx") return importDocx(file);

    const text = await file.text();
    if (ext === ".ebb") return importEbbText(text, file.name);
    if (ext === ".json") return importJsonText(text, file.name);
    if (ext === ".csv") return importDelimitedText(text, file.name, ",");
    if (ext === ".tsv") return importDelimitedText(text, file.name, "\t");
    if (ext === ".txt" || ext === ".md") return importPlainText(text, file.name);

    // No recognized extension (or a misleading one) — sniff the content
    // before giving up, since a debater renaming a .ebb to "flow.bak" should
    // still open.
    if (text && isFlowFileText(text)) return importEbbText(text, file.name);

    const err = new Error(
        `Cascade can't open "${file.name}". It opens ${ACCEPTED_EXTENSIONS.join(", ")} files.`,
    );
    err.unsupportedType = true;
    throw err;
}

async function importEbbText(text, name) {
    try {
        const round = parseFlowFile(text);
        store.setRound(round, { fileName: name });
        return { status: "opened", detail: name };
    } catch (err) {
        await showParseError(name, err);
        return { status: "error", detail: err };
    }
}

async function importJsonText(text, name) {
    try {
        const round = parseFlowFile(text);
        store.setRound(round, { fileName: name });
        return { status: "opened", detail: name };
    } catch (firstErr) {
        // Not a single-round .ebb-shaped file — try the legacy/backup shape,
        // which can hold many rounds (ebb's {kind:"backup"} export).
        let rounds;
        try {
            rounds = parseLegacyExport(text);
        } catch {
            await showParseError(name, firstErr);
            return { status: "error", detail: firstErr };
        }
        if (!rounds.length) {
            await showParseError(name, new Error(`${name} contains no rounds.`));
            return { status: "error", detail: "empty" };
        }
        if (rounds.length === 1) {
            store.setRound(rounds[0], { fileName: name });
            return { status: "opened", detail: name };
        }
        return pickAndOpenRounds(rounds, name);
    }
}

/** Modal picker for a multi-round backup/legacy export: pick which to import. */
async function pickAndOpenRounds(rounds, name) {
    const rows = rounds.map((round, i) => {
        const s = round.scouting ?? {};
        const label = `${s.tournament || "Untitled tournament"} · ${s.round || "?"} · ` +
            `${round.event || "policy"} · ${(round.sheets ?? []).length} sheets`;
        const checkbox = el("input", { type: "checkbox", checked: true });
        const row = el(
            "label.import-picker-row",
            { style: { display: "flex", gap: "8px", alignItems: "center", padding: "4px 0" } },
            checkbox,
            el("span", { text: label }),
        );
        return { round, checkbox, row, i };
    });
    const body = el(
        "div.import-picker",
        {},
        el("p", { text: `${name} contains ${rounds.length} rounds. Choose which to import.` }),
        el("div.import-picker-list", {}, ...rows.map((r) => r.row)),
    );
    const action = await ui.modal({
        title: "Choose rounds to import",
        body,
        actions: [
            { id: "cancel", label: "Cancel" },
            { id: "import", label: "Import selected", primary: true },
        ],
        width: 480,
    });
    if (action !== "import") return { status: "cancelled", detail: name };
    const selected = rows.filter((r) => r.checkbox.checked).map((r) => r.round);
    if (!selected.length) return { status: "cancelled", detail: name };
    const [first, ...rest] = selected;
    store.setRound(first, { fileName: name });
    if (rest.length) await stashOrOfferDownload(rest);
    const label = first.scouting?.tournament || name;
    return { status: "opened", detail: rest.length ? `${label} (+${rest.length} stashed)` : label };
}

/**
 * Everything beyond the round the user chose to open needs a home. store.js's
 * documented API has no "add this round to the autosave DB" call, only
 * recents()/restoreRecent(id) for rounds already there — so this feature-
 * detects a handful of plausible method names and only falls back to
 * individual downloads when none exist.
 */
async function stashOrOfferDownload(rounds) {
    const stashFn = store.stashRound ?? store.addRound ?? store.saveRecent ?? store.importRound;
    if (typeof stashFn === "function") {
        for (const round of rounds) {
            try {
                await stashFn.call(store, round);
            } catch {
                // best effort — one bad stash shouldn't block the rest
            }
        }
        ui.toast(`Stashed ${rounds.length} more round${rounds.length === 1 ? "" : "s"} into autosave.`, {
            type: "success",
        });
        return;
    }
    const action = await ui.modal({
        title: "Download the remaining rounds?",
        body: el("p", {
            text: `Cascade can't stash extra rounds automatically here. Download the other ` +
                `${rounds.length} as .ebb files instead?`,
        }),
        actions: [
            { id: "skip", label: "Skip" },
            { id: "download", label: "Download all", primary: true },
        ],
    });
    if (action === "download") {
        for (const round of rounds) {
            download(sanitizeFilename(suggestFilename(round)), serializeFlow(round, { strict: false }), "application/json");
        }
    }
}

// --- CSV / TSV import ---------------------------------------------------------

/**
 * RFC4180-ish delimited-text parser. Handles quoted fields containing the
 * delimiter, embedded newlines, and escaped quotes ("" inside a quoted
 * field), and accepts CRLF, bare CR, or bare LF line endings — spreadsheet
 * exports are not consistent about any of this.
 * @param {string} text
 * @param {string} delimiter single character
 * @returns {string[][]} rows of fields (rows may be ragged)
 */
export function parseDelimited(text, delimiter = ",") {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += c;
            i++;
            continue;
        }
        if (c === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (c === delimiter) {
            row.push(field);
            field = "";
            i++;
            continue;
        }
        if (c === "\r") {
            row.push(field);
            field = "";
            rows.push(row);
            row = [];
            i++;
            if (text[i] === "\n") i++; // swallow the paired LF of a CRLF
            continue;
        }
        if (c === "\n") {
            row.push(field);
            field = "";
            rows.push(row);
            row = [];
            i++;
            continue;
        }
        field += c;
        i++;
    }
    if (field.length || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/** Quote a field only when it needs it, per RFC4180. */
function delimitedField(value, delimiter) {
    const s = String(value ?? "");
    if (s.includes('"') || s.includes(delimiter) || /[\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/** Serialize a grid of rows back to delimited text, CRLF-terminated. */
export function toDelimited(rows, delimiter = ",") {
    return rows.map((row) => row.map((v) => delimitedField(v, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}

async function importDelimitedText(text, name, delimiter) {
    const grid = parseDelimited(text, delimiter).filter((r) => !(r.length === 1 && r[0] === ""));
    if (!grid.length) throw new Error(`${name} has no rows to import.`);
    const colCount = grid.reduce((max, r) => Math.max(max, r.length), 0);
    const round = makeFlowRound();
    // makeFlowRound() already seeded a default CX sheet (for events that have
    // one) plus a throwaway "1." flow sheet — keep the CX sheet, since a fresh
    // round should still look like a normal one, and replace only the latter
    // with the sheet the CSV actually fills in.
    const cxSheets = round.sheets.filter((s) => s.kind === "cx");
    const sheet = makeFlowSheet({ title: "1.", group: "aff", order: 0 });
    round.sheets = [...cxSheets, sheet];
    const speeches = sheetColumns(round, sheet);
    const mapping = await pickColumnMapping({ name, grid, colCount, speeches });
    if (!mapping) return { status: "cancelled", detail: name };
    const width = Math.max(speeches.length, 1);
    sheet.data = grid.map((srcRow) => {
        const out = new Array(width).fill(null);
        for (let c = 0; c < srcRow.length; c++) {
            const target = mapping[c];
            if (target == null || target < 0) continue;
            out[target] = srcRow[c] === "" ? null : srcRow[c];
        }
        return out;
    });
    store.setRound(round, { fileName: name });
    return { status: "opened", detail: name };
}

/** Modal: map each source column to a speech column, or skip it. */
async function pickColumnMapping({ name, grid, colCount, speeches }) {
    const sample = grid[0] ?? [];
    const rows = [];
    for (let c = 0; c < colCount; c++) {
        const select = el("select", {});
        select.append(el("option", { value: "-1", text: "Skip this column" }));
        speeches.forEach((sp, i) => {
            select.append(el("option", { value: String(i), text: `${sp.short ?? sp.name} — ${sp.name ?? ""}` }));
        });
        select.value = c < speeches.length ? String(c) : "-1";
        rows.push({
            select,
            node: el(
                "div.column-map-row",
                { style: { display: "flex", gap: "10px", alignItems: "center", padding: "3px 0" } },
                el("span", { style: { minWidth: "80px" }, text: `Column ${c + 1}` }),
                el("span", {
                    style: { minWidth: "140px", opacity: "0.7", fontFamily: "monospace" },
                    text: sample[c] ? truncate(sample[c], 40) : "(empty)",
                }),
                select,
            ),
        });
    }
    const body = el(
        "div.column-map",
        {},
        el("p", { text: `Map ${name}'s columns to speeches before importing.` }),
        ...rows.map((r) => r.node),
    );
    const action = await ui.modal({
        title: "Map columns to speeches",
        body,
        actions: [
            { id: "cancel", label: "Cancel" },
            { id: "import", label: "Import", primary: true },
        ],
        width: 560,
    });
    if (action !== "import") return null;
    return rows.map((r) => Number(r.select.value));
}

// --- Plain text / Markdown import --------------------------------------------

async function importPlainText(text, name) {
    const splitOnBlank = await ui.confirm(
        "Start a new sheet at every blank line? Choose \"No\" to keep everything on one sheet.",
        { title: `Import ${name}`, confirmLabel: "New sheet per blank line" },
    );
    const lines = text.split(/\r\n|\r|\n/);
    const sheetsLines = [];
    if (splitOnBlank) {
        let current = [];
        for (const line of lines) {
            if (line.trim() === "") {
                if (current.length) sheetsLines.push(current);
                current = [];
            } else {
                current.push(line);
            }
        }
        if (current.length) sheetsLines.push(current);
    } else {
        const nonEmpty = lines.filter((l) => l.trim() !== "");
        if (nonEmpty.length) sheetsLines.push(nonEmpty);
    }
    if (!sheetsLines.length) throw new Error(`${name} has no non-empty lines to import.`);
    const round = makeFlowRound();
    const cxSheets = round.sheets.filter((s) => s.kind === "cx");
    const flowSheets = sheetsLines.map((linesForSheet, i) => {
        const sheet = makeFlowSheet({ title: `${i + 1}.`, group: "aff", order: i });
        sheet.data = linesForSheet.map((l) => [l]);
        return sheet;
    });
    round.sheets = [...cxSheets, ...flowSheets];
    store.setRound(round, { fileName: name });
    return { status: "opened", detail: name };
}

// --- .docx import --------------------------------------------------------------

async function importDocx(file) {
    // No CDN dependency allowed: only use mammoth if the host page already
    // loaded it (e.g. the desktop shell bundles it locally). Otherwise this
    // is exactly the "paste the text instead" path the spec calls for.
    if (typeof window !== "undefined" && typeof window.mammoth?.extractRawText === "function") {
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        return importPlainText(result.value ?? "", file.name);
    }
    return offerDocxFallback(file.name);
}

async function offerDocxFallback(name) {
    const textarea = el("textarea.docx-paste", {
        rows: "12",
        style: { width: "100%", boxSizing: "border-box" },
        placeholder: "Paste the document text here…",
    });
    const body = el(
        "div.docx-fallback",
        {},
        el("p", {
            text: `Cascade's web version can't read .docx directly — that needs the desktop app, ` +
                `or a "mammoth" script the page doesn't load. Paste the text below and it will ` +
                `import like a .txt file.`,
        }),
        textarea,
    );
    const action = await ui.modal({
        title: `Can't open ${name}`,
        body,
        actions: [
            { id: "cancel", label: "Cancel" },
            { id: "paste", label: "Import pasted text", primary: true },
        ],
        width: 560,
    });
    if (action === "paste" && textarea.value.trim()) {
        return importPlainText(textarea.value, name.replace(/\.docx$/i, ".txt"));
    }
    return { status: "cancelled", detail: name };
}

// --- Parse-error / summary reporting ------------------------------------------

/** Every parse failure gets the exact validator message, with a copy button. */
async function showParseError(name, err) {
    const message = err?.message ?? String(err);
    for (;;) {
        const body = el(
            "div.import-error",
            {},
            el("p", { text: `Cascade couldn't import ${name}:` }),
            el("pre.import-error-detail", {
                style: { whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: "13px" },
                text: message,
            }),
        );
        const action = await ui.modal({
            title: "Import failed",
            body,
            actions: [
                { id: "copy", label: "Copy error" },
                { id: "close", label: "Close", primary: true },
            ],
            width: 520,
        });
        if (action !== "copy") return;
        try {
            await navigator.clipboard.writeText(message);
            ui.toast("Error copied.", { type: "success" });
        } catch {
            ui.toast("Couldn't copy — select the text manually.", { type: "warn" });
        }
        // Loop back so the modal re-opens after copying instead of vanishing —
        // the debater still needs to read (or copy again) before closing it.
    }
}

function reportImportSummary(results) {
    const opened = results.filter((r) => r.status === "opened");
    const skipped = results.filter((r) => r.status === "error" || r.status === "cancelled");
    const parts = [];
    if (opened.length === 1) parts.push(`Opened ${opened[0].detail || opened[0].file.name}`);
    else if (opened.length > 1) parts.push(`Opened ${opened.length} files`);
    if (skipped.length) parts.push(`${skipped.length} file${skipped.length === 1 ? "" : "s"} skipped`);
    if (!parts.length) return;
    ui.toast(parts.join(" · "), { type: opened.length ? "success" : "warn" });
}

function triggerImportPicker() {
    const input = el("input", {
        type: "file",
        multiple: true,
        accept: ACCEPTED_EXTENSIONS.join(","),
        style: { display: "none" },
    });
    input.addEventListener("change", () => {
        const files = [...(input.files ?? [])];
        input.remove();
        if (files.length) importFiles(files);
    });
    document.body.append(input);
    input.click();
}

// --- Export helpers ------------------------------------------------------------

function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

function roundBaseName(round) {
    return suggestFilename(round).replace(/\.ebb$/i, "");
}

function withExt(base, ext) {
    return `${base}${ext}`;
}

/**
 * Write bytes out. Prefers the File System Access API (silent overwrite after
 * the first save-as), falls back to dom.js's anchor-click download.
 */
async function saveOrDownload(filename, data, mime) {
    if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
        try {
            const ext = extOf(filename) || ".txt";
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: "Cascade export", accept: { [mime]: [ext] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(new Blob([data], { type: mime }));
            await writable.close();
            ui.toast(`Saved ${filename}`, { type: "success" });
            return;
        } catch (err) {
            if (err?.name === "AbortError") return; // user cancelled the picker
            // Any other failure (permission, unsupported type, etc.) falls
            // through to a plain download so the export never just vanishes.
        }
    }
    download(filename, data, mime);
}

function sheetToGrid(round, sheet) {
    const speeches = sheetColumns(round, sheet);
    const data = sheet.data ?? [];
    const width = Math.max(speeches.length, ...data.map((r) => r.length), 1);
    const header = speeches.length
        ? speeches.map((sp) => sp.short ?? sp.name ?? "")
        : Array.from({ length: width }, (_, i) => `Col ${i + 1}`);
    const rows = data.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ""));
    return { header, rows };
}

// --- .ebb / .json exports -------------------------------------------------------

function exportEbbNative() {
    const round = store.round;
    if (!round) return;
    saveOrDownload(sanitizeFilename(suggestFilename(round)), serializeFlow(round, { strict: false }), "application/json");
}

function exportEbbStrict() {
    const round = store.round;
    if (!round) return;
    const name = withExt(`${roundBaseName(round)} (interop)`, ".ebb");
    saveOrDownload(sanitizeFilename(name), serializeFlow(round, { strict: true }), "application/json");
}

function exportJson() {
    const round = store.round;
    if (!round) return;
    const name = withExt(roundBaseName(round), ".json");
    saveOrDownload(sanitizeFilename(name), serializeFlow(round, { strict: false }), "application/json");
}

// --- CSV export ------------------------------------------------------------------

function downloadSheetCsv(round, sheet) {
    const { header, rows } = sheetToGrid(round, sheet);
    const text = toDelimited([header, ...rows], ",");
    const name = withExt(`${roundBaseName(round)} — ${sheet.title}`, ".csv");
    saveOrDownload(sanitizeFilename(name), text, "text/csv");
}

/** file.exportCsv: the active sheet if there's only one, otherwise a picker. */
async function exportCsvPicker() {
    const round = store.round;
    if (!round) return;
    const sheets = sortedSheets(round);
    if (!sheets.length) return ui.toast("This round has no sheets.", { type: "warn" });
    if (sheets.length === 1) return downloadSheetCsv(round, sheets[0]);
    const activeId = store.activeSheetId;
    const body = el("p", { text: "Choose a sheet to export as CSV." });
    const actions = [
        ...sheets.map((s) => ({ id: s.id, label: `${s.title}${s.id === activeId ? " (active)" : ""}` })),
        { id: "cancel", label: "Cancel" },
    ];
    const chosen = await ui.modal({ title: "Export sheet as CSV", body, actions, width: 420 });
    if (!chosen || chosen === "cancel") return;
    const sheet = sheets.find((s) => s.id === chosen);
    if (sheet) downloadSheetCsv(round, sheet);
}

// --- Markdown export ---------------------------------------------------------------

function mdEscapeCell(v) {
    return String(v ?? "").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

function sheetMarkdownTable(round, sheet) {
    const { header, rows } = sheetToGrid(round, sheet);
    const head = `| ${header.map(mdEscapeCell).join(" | ")} |`;
    const sep = `| ${header.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => `| ${r.map(mdEscapeCell).join(" | ")} |`).join("\n");
    return [head, sep, body].filter(Boolean).join("\n");
}

function fullName(person) {
    if (!person) return "";
    return `${person.first ?? ""} ${person.last ?? ""}`.trim();
}

function scoutingHeaderMarkdown(round) {
    const s = round.scouting ?? {};
    const affNames = [fullName(s.aff?.first), fullName(s.aff?.second)].filter(Boolean).join(" & ");
    const negNames = [fullName(s.neg?.first), fullName(s.neg?.second)].filter(Boolean).join(" & ");
    return [
        `# ${s.tournament || "Untitled tournament"}${s.round ? ` — ${s.round}` : ""}`,
        "",
        `- **Event:** ${round.event || "policy"}`,
        `- **Aff:** ${[s.affSchool, affNames && `(${affNames})`].filter(Boolean).join(" ")}`,
        `- **Neg:** ${[s.negSchool, negNames && `(${negNames})`].filter(Boolean).join(" ")}`,
        `- **Judge:** ${s.judge || ""}`,
        `- **Date:** ${s.date || ""}`,
    ].join("\n");
}

function exportMarkdownActive() {
    const round = store.round;
    const sheet = store.activeSheet;
    if (!round || !sheet) return ui.toast("No active sheet to export.", { type: "warn" });
    const text = `${scoutingHeaderMarkdown(round)}\n\n## ${sheet.title}\n\n${sheetMarkdownTable(round, sheet)}\n`;
    const name = withExt(`${roundBaseName(round)} — ${sheet.title}`, ".md");
    saveOrDownload(sanitizeFilename(name), text, "text/markdown");
}

function exportMarkdownRound() {
    const round = store.round;
    if (!round) return;
    const parts = [scoutingHeaderMarkdown(round), ""];
    for (const sheet of sortedSheets(round)) {
        parts.push(`## ${sheet.title}`, "", sheetMarkdownTable(round, sheet), "");
    }
    const name = withExt(roundBaseName(round), ".md");
    saveOrDownload(sanitizeFilename(name), parts.join("\n"), "text/markdown");
}

async function exportMarkdown() {
    const round = store.round;
    if (!round) return;
    const choice = await ui.modal({
        title: "Export Markdown",
        body: el("p", { text: "Export the active sheet only, or every sheet in the round?" }),
        actions: [
            { id: "active", label: "Active sheet" },
            { id: "round", label: "Whole round", primary: true },
            { id: "cancel", label: "Cancel" },
        ],
    });
    if (choice === "active") exportMarkdownActive();
    else if (choice === "round") exportMarkdownRound();
}

// --- Plain-text export ---------------------------------------------------------------

function scoutingHeaderPlainText(round) {
    const s = round.scouting ?? {};
    return [
        `${s.tournament || "Untitled tournament"}${s.round ? ` — ${s.round}` : ""}`,
        `Event: ${round.event || "policy"}    Judge: ${s.judge || ""}    Date: ${s.date || ""}`,
    ].join("\n");
}

function sheetPlainText(round, sheet) {
    const speeches = sheetColumns(round, sheet);
    const data = sheet.data ?? [];
    const width = Math.max(speeches.length, ...data.map((r) => r.length), 1);
    const title = `${sheet.title} (${sheet.group})`;
    const lines = [title, "=".repeat(title.length)];
    for (let c = 0; c < width; c++) {
        const label = speeches[c]?.name ?? speeches[c]?.short ?? `Column ${c + 1}`;
        lines.push("", label, "-".repeat(label.length));
        let any = false;
        for (const row of data) {
            const v = row[c];
            if (v) {
                any = true;
                lines.push(`    ${String(v).replace(/\n/g, "\n    ")}`);
            }
        }
        if (!any) lines.push("    (empty)");
    }
    return lines.join("\n");
}

function exportText() {
    const round = store.round;
    if (!round) return;
    const parts = [scoutingHeaderPlainText(round), ""];
    for (const sheet of sortedSheets(round)) parts.push(sheetPlainText(round, sheet), "");
    const name = withExt(roundBaseName(round), ".txt");
    saveOrDownload(sanitizeFilename(name), parts.join("\n"), "text/plain");
}

// --- Cite sheet export ---------------------------------------------------------------

/**
 * Every `meta.card` cell, joined with its `round.cascade.evidence` detail
 * when one exists. Computed here rather than imported from insights.js —
 * feature modules never import each other, only the shared contracts.
 */
function collectCites(round) {
    const evidenceList = round.cascade?.evidence ?? [];
    const bySheetCell = new Map();
    for (const ev of evidenceList) bySheetCell.set(`${ev.sheetId}:${ev.row},${ev.col}`, ev);
    const cites = [];
    for (const sheet of sortedSheets(round)) {
        for (const [key, m] of Object.entries(sheet.meta ?? {})) {
            if (!m?.card) continue;
            const [rowStr, colStr] = key.split(",");
            const row = Number(rowStr);
            const col = Number(colStr);
            cites.push({
                sheet,
                row,
                col,
                text: getCell(sheet, row, col),
                evidence: bySheetCell.get(`${sheet.id}:${row},${col}`),
            });
        }
    }
    return cites;
}

function citeSheetMarkdown(round) {
    const cites = collectCites(round);
    const lines = [scoutingHeaderMarkdown(round), "", "# Cite sheet", ""];
    if (!cites.length) {
        lines.push("_No cards marked in this round._");
        return `${lines.join("\n")}\n`;
    }
    cites.forEach((c, i) => {
        const ev = c.evidence;
        const cite = ev?.cite || [ev?.author, ev?.year].filter(Boolean).join(" ");
        lines.push(`## ${i + 1}. ${c.sheet.title} — ${cite || "(uncited)"}`);
        if (ev?.tag) lines.push(`*Tag: ${ev.tag}*`);
        if (ev?.url) lines.push(`[Source](${ev.url})`);
        lines.push("", `> ${mdEscapeCell(c.text).replace(/<br>/g, "\n> ")}`, "");
    });
    return `${lines.join("\n")}\n`;
}

function exportCites() {
    const round = store.round;
    if (!round) return;
    const name = withExt(`${roundBaseName(round)} — cites`, ".md");
    saveOrDownload(sanitizeFilename(name), citeSheetMarkdown(round), "text/markdown");
}

// --- Print / PDF ---------------------------------------------------------------------

let printStyleReady = false;

/**
 * The print stylesheet lives entirely inline here (exports.js doesn't own
 * app.css) using the classic "hide everything, then unhide the print root"
 * trick, so it never depends on the shell agent adding print rules.
 */
function ensurePrintStyle() {
    if (printStyleReady) return;
    document.head.append(
        el("style#cascade-print-style", {
            text: `
@media print {
    body > *:not(#cascade-print-root) { display: none !important; }
    #cascade-print-root {
        display: block !important;
        position: static !important;
        left: auto !important;
    }
    .cascade-print-page { page-break-after: always; padding: 8mm; }
    .cascade-print-page:last-child { page-break-after: auto; }
    .cascade-print-table { width: 100%; border-collapse: collapse; }
    .cascade-print-table th, .cascade-print-table td {
        border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top;
        white-space: pre-wrap; font-size: 11px;
    }
    .cascade-print-header { font-weight: 700; margin-bottom: 6px; }
    .cascade-print-footer { margin-top: 6px; font-size: 10px; color: #666; text-align: right; }
    @page { size: landscape; margin: 10mm; }
}
`,
        }),
    );
    printStyleReady = true;
}

function ensurePrintRoot() {
    let root = $("#cascade-print-root");
    if (!root) {
        // Kept in the live DOM (not display:none) so print CSS can restyle it,
        // but pushed off-screen so it's invisible during normal use.
        root = el("div#cascade-print-root", {
            style: { position: "fixed", top: "0", left: "-99999px" },
        });
        document.body.append(root);
    }
    return root;
}

function buildPrintDoc(round, sheets) {
    const root = ensurePrintRoot();
    clear(root);
    const total = sheets.length;
    const headline = scoutingHeaderPlainText(round).split("\n")[0];
    sheets.forEach((sheet, i) => {
        const speeches = sheetColumns(round, sheet);
        const data = sheet.data ?? [];
        const width = Math.max(speeches.length, ...data.map((r) => r.length), 1);
        const cols = Array.from({ length: width }, (_, c) => speeches[c]?.short ?? speeches[c]?.name ?? `Col ${c + 1}`);
        root.append(
            el(
                "div.cascade-print-page",
                {},
                el("div.cascade-print-header", { text: `${headline} — ${sheet.title}` }),
                el(
                    "table.cascade-print-table",
                    {},
                    el("thead", {}, el("tr", {}, ...cols.map((label) => el("th", { text: label })))),
                    el(
                        "tbody",
                        {},
                        ...data.map((row) =>
                            el(
                                "tr",
                                {},
                                ...Array.from({ length: width }, (_, c) => el("td", { text: row[c] ?? "" })),
                            ),
                        ),
                    ),
                ),
                el("div.cascade-print-footer", { text: `Page ${i + 1} of ${total}` }),
            ),
        );
    });
}

async function printFlow() {
    const round = store.round;
    if (!round) return;
    const choice = await ui.modal({
        title: "Print / PDF",
        body: el("p", { text: "Print the active sheet, or every sheet in the round?" }),
        actions: [
            { id: "active", label: "Active sheet" },
            { id: "round", label: "Whole round", primary: true },
            { id: "cancel", label: "Cancel" },
        ],
    });
    if (choice !== "active" && choice !== "round") return;
    const sheets = choice === "active" ? [store.activeSheet].filter(Boolean) : sortedSheets(round);
    if (!sheets.length) return ui.toast("Nothing to print.", { type: "warn" });
    ensurePrintStyle();
    buildPrintDoc(round, sheets);
    window.print();
}

// --- Backup everything ---------------------------------------------------------------

/**
 * `{version, kind:"backup", rounds:[...]}` — the same shape ebb's own legacy
 * backup export uses, so a Cascade backup opens straight back into ebb too.
 * store.js's documented API has no read-only way to peek at another round
 * without loading it live, so this walks recents() via restoreRecent(),
 * snapshots each one, and puts the original round back before returning —
 * wrapped in try/finally so a failure mid-walk can never strand the user on
 * someone else's flow.
 */
async function backupAll() {
    const originalRound = store.round;
    const originalFileName = store.fileName;
    const wasDirty = store.dirty;
    let rounds = [];
    const canWalkRecents = typeof store.recents === "function" && typeof store.restoreRecent === "function";
    if (canWalkRecents) {
        let entries = [];
        try {
            entries = await store.recents();
        } catch {
            entries = [];
        }
        // restoreRecent() is confirmed destructive to the *current* round's
        // undo stack and file handle (store.js resets both on every
        // setRound()), since it loads each recent as the live round to read
        // it. Say so up front rather than silently blowing away undo history
        // the debater didn't ask to lose; declining still backs up the round
        // that's open right now.
        let proceed = entries.length > 0;
        if (entries.length > 1) {
            proceed = await ui.confirm(
                `Backing up all ${entries.length} autosaved rounds briefly switches through each one, ` +
                    `which resets this round's undo history (no content is lost either way). Continue?`,
                { title: "Backup everything", confirmLabel: "Back up everything" },
            );
        }
        if (proceed) {
            try {
                for (const entry of entries) {
                    try {
                        const ok = await store.restoreRecent(entry.id);
                        if (ok !== false && store.round) rounds.push(structuredClone(store.round));
                    } catch {
                        // one unreadable recent shouldn't sink the whole backup
                    }
                }
            } finally {
                if (originalRound) {
                    try {
                        store.setRound(originalRound, { fileName: originalFileName, markClean: !wasDirty });
                    } catch {
                        // best-effort restore
                    }
                }
            }
        }
    }
    if (!rounds.length && originalRound) rounds = [originalRound];
    if (!rounds.length) return ui.toast("Nothing to back up yet.", { type: "warn" });
    const backup = { version: FLOW_FILE_VERSION, kind: "backup", rounds };
    const text = `${JSON.stringify(backup, null, 2)}\n`;
    const stamp = new Date().toISOString().slice(0, 10);
    await saveOrDownload(`cascade-backup-${stamp}.json`, text, "application/json");
}

// --- Toolbar Export menu --------------------------------------------------------------

const EXPORT_MENU_ITEMS = [
    { id: "file.exportEbb", label: "Export .ebb (native)" },
    { id: "file.exportEbbStrict", label: "Export .ebb (interop, strict)" },
    { id: "file.exportJson", label: "Export .json" },
    { id: "file.exportCsv", label: "Export .csv…" },
    { id: "file.exportMarkdown", label: "Export Markdown…" },
    { id: "file.exportText", label: "Export .txt" },
    { id: "file.exportCites", label: "Export cite sheet" },
    { id: "file.print", label: "Print / PDF…" },
    { id: "file.backupAll", label: "Backup everything…" },
];

/** ui.js has no submenu primitive, so the Export toolbar button opens a modal whose actions *are* the menu. */
async function openExportMenu() {
    const body = el("p", { text: "Choose an export." });
    const actions = [...EXPORT_MENU_ITEMS.map((it) => ({ id: it.id, label: it.label })), { id: "cancel", label: "Cancel" }];
    const chosen = await ui.modal({ title: "Export", body, actions, width: 360 });
    if (chosen && chosen !== "cancel") runCommand(chosen);
}

// --- Commands + init -------------------------------------------------------------------

function registerCommands() {
    registerAll([
        {
            id: "file.import",
            title: "Import flow file…",
            category: "File",
            icon: "⇪",
            keys: ["Mod+Shift+I"],
            run: triggerImportPicker,
        },
        { id: "file.exportEbb", title: "Export .ebb", category: "File", run: exportEbbNative },
        { id: "file.exportEbbStrict", title: "Export .ebb (interop, strict)", category: "File", run: exportEbbStrict },
        { id: "file.exportJson", title: "Export .json", category: "File", run: exportJson },
        { id: "file.exportCsv", title: "Export .csv…", category: "File", run: exportCsvPicker },
        { id: "file.exportMarkdown", title: "Export Markdown…", category: "File", run: exportMarkdown },
        { id: "file.exportText", title: "Export .txt", category: "File", run: exportText },
        { id: "file.exportCites", title: "Export cite sheet", category: "File", run: exportCites },
        {
            id: "file.print",
            title: "Print / PDF…",
            category: "File",
            // Mod+P is a sheet quick-switcher (palette.js); this chord leaves
            // the browser's own Mod+P print shortcut alone too.
            keys: ["Mod+Shift+Enter"],
            run: printFlow,
        },
        { id: "file.backupAll", title: "Backup everything…", category: "File", run: backupAll },
    ]);
}

/** Called once by main.js after the shell and store exist. */
export function init() {
    initDragDrop();
    wireStartScreen();
    registerCommands();
    ui.addToolbarButton({
        id: "exports.menu",
        label: "Export",
        icon: "⭳",
        title: "Export or print this flow",
        slot: "right",
        onClick: openExportMenu,
    });
    // The hidden print DOM only needs to exist for the duration of a print;
    // clear it after so it never lingers as dead weight in the live page.
    window.addEventListener("afterprint", () => {
        const root = $("#cascade-print-root");
        if (root) clear(root);
    });
}

export const exporter = { init, importFiles, parseDelimited, toDelimited };
export default exporter;
