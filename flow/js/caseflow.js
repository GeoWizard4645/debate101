/**
 * Cascade — Verbatim case import.
 *
 * Parses .docx cases formatted with Verbatim styles (Heading 2, Tag, Cite)
 * into flow sheets. This is the logic that used to live in the standalone
 * Auto Flow Generator on the main site.
 */

import { makeFlowRound, makeFlowSheet } from "./model.js";

/** Mammoth style map for Verbatim-formatted debate cases. */
export const VERBATIM_STYLE_MAP = [
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Tag'] => h4:fresh",
    "p[style-name='Cite'] => p.cite:fresh",
];

const FLOW_HEADER_LABELS = new Set([
    "1AC", "2AC", "1NC", "2NC", "1NR", "1AR", "2NR", "2AR", "Block",
]);

/**
 * Walk parsed Verbatim HTML into sections of tag rows.
 * @param {string} html
 * @param {boolean} isNegMode
 * @returns {{ title: string, rows: string[][] }[]}
 */
export function parseVerbatimHtml(html, isNegMode) {
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(html, "text/html");
    const elements = Array.from(htmlDoc.querySelectorAll("h2, h4, p"));

    const sections = [];
    let currentTitle = "Flow";
    let currentRows = [];

    function flushSection() {
        if (currentRows.length) {
            sections.push({ title: currentTitle, rows: currentRows });
            currentRows = [];
        }
    }

    for (let i = 0; i < elements.length; i++) {
        const node = elements[i];
        if (isNegMode && node.tagName === "H2") {
            flushSection();
            currentTitle = node.textContent.trim() || "Argument";
            continue;
        }

        if (node.tagName === "H4" && node.textContent.trim()) {
            let tag = node.textContent.trim();
            const next = elements[i + 1];
            const hasCite =
                next &&
                (next.classList?.contains("cite") ||
                    /\b[A-Z][a-z]+.* (\d{2}|\d{4})\b/.test(next.textContent));
            if (hasCite) {
                tag += ` (${next.textContent.trim()})`;
                i++;
            }
            currentRows.push([tag]);
            currentRows.push([]);
        }
    }

    flushSection();
    if (!sections.length && currentRows.length) {
        sections.push({ title: currentTitle, rows: currentRows });
    }
    return sections;
}

/**
 * Parse a Verbatim .docx buffer into flow sections.
 * @param {ArrayBuffer} arrayBuffer
 * @param {boolean} isNegMode
 * @returns {Promise<{ title: string, rows: string[][] }[]>}
 */
export async function parseVerbatimDocx(arrayBuffer, isNegMode) {
    if (typeof window === "undefined" || typeof window.mammoth?.convertToHtml !== "function") {
        throw new Error("mammoth is not loaded");
    }
    const result = await window.mammoth.convertToHtml(
        { arrayBuffer },
        { styleMap: VERBATIM_STYLE_MAP },
    );
    return parseVerbatimHtml(result.value ?? "", isNegMode);
}

/**
 * @param {{ title: string, rows: string[][] }[]} sections
 * @param {{ group?: "aff"|"neg", event?: string, firstSide?: "aff"|"neg" }} [opts]
 */
export function sectionsToFlowRound(sections, opts = {}) {
    const group = opts.group ?? "aff";
    const round = makeFlowRound({ event: opts.event, firstSide: opts.firstSide });
    const cxSheets = round.sheets.filter((s) => s.kind === "cx");
    const flowSheets = sections.map((sec, i) => {
        const sheet = makeFlowSheet({
            title: sections.length > 1 ? sec.title : `${i + 1}.`,
            group,
            order: i,
        });
        sheet.data = sec.rows.map((row) => {
            const out = [row[0] ?? null];
            return out;
        });
        return sheet;
    });
    round.sheets = [
        ...cxSheets,
        ...(flowSheets.length ? flowSheets : [makeFlowSheet({ title: "1.", group, order: 0 })]),
    ];
    return round;
}

/** @returns {boolean} */
export function hasVerbatimContent(sections) {
    return sections.some((s) => s.rows.some((r) => r[0]?.trim()));
}

/**
 * Read an .xlsx buffer into named sheet grids.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ name: string, grid: string[][] }[]}
 */
export function parseXlsxBuffer(arrayBuffer) {
    if (typeof window === "undefined" || !window.XLSX) {
        throw new Error("XLSX is not loaded");
    }
    const wb = window.XLSX.read(arrayBuffer, { type: "array" });
    return wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        /** @type {string[][]} */
        const grid = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        return { name, grid };
    }).filter((s) => s.grid.length > 0);
}

/**
 * Detect whether a row is a flow-template header row and return column mapping.
 * @param {string[]} headerRow
 * @param {{ short?: string, name?: string, aliases?: string[] }[]} speeches
 * @returns {number[] | null} mapping per source column, -1 = skip
 */
export function detectFlowHeaders(headerRow, speeches) {
    const labels = headerRow.map((c) => String(c ?? "").trim());
    const knownCount = labels.filter((l) => FLOW_HEADER_LABELS.has(l)).length;
    const speechCount = labels.filter((l) =>
        speeches.some(
            (sp) =>
                sp.short === l ||
                sp.name === l ||
                (sp.aliases && sp.aliases.includes(l)),
        ),
    ).length;
    if (knownCount < 2 && speechCount < 2) return null;

    return labels.map((label) => {
        const idx = speeches.findIndex(
            (sp) =>
                sp.short === label ||
                sp.name === label ||
                (sp.aliases && sp.aliases.includes(label)),
        );
        return idx >= 0 ? idx : -1;
    });
}

/**
 * Apply a column mapping to a source grid.
 * @param {string[][]} grid
 * @param {number[]} mapping
 * @param {number} width
 * @returns {(string|null)[][]}
 */
export function applyColumnMapping(grid, mapping, width) {
    return grid.map((srcRow) => {
        const out = new Array(width).fill(null);
        for (let c = 0; c < srcRow.length; c++) {
            const target = mapping[c];
            if (target == null || target < 0) continue;
            const val = srcRow[c];
            out[target] = val === "" || val == null ? null : String(val);
        }
        return out;
    });
}
