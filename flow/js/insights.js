/**
 * Cascade — FEATURE 5 + 6: Round Analytics + Evidence Tracker.
 *
 * Two dock panels sharing one module because they read the same raw
 * material — the grid's cells and their meta — and a debater reaches for
 * them at the same moment (post-round, or between speeches while prepping
 * the next one). Analytics answers "how did the round go"; the evidence
 * tracker turns every cell marked as a card into a cite-sheet entry the
 * team can paste into a post-round email.
 *
 * `analyze(round)` is kept pure and exported on its own so it can be unit
 * tested without a DOM: it takes a plain round object and returns a plain
 * object, and every chart function below just renders that object. Nothing
 * else in this file should recompute round math — if a panel needs a
 * number, it comes from `analyze()`.
 */

import bus from "./bus.js";
import { el, clear, esc, fmtClock, debounce, download, MOD_LABEL } from "./dom.js";
import { register } from "./registry.js";
import { sortedSheets, sheetColumns, getMeta, ensureCascade, happenedColumns } from "./model.js";
import { getEvent, speechOrder, speechSeconds } from "./events.js";
import { store } from "./store.js";
import { ui } from "./ui.js";
import { suggestFilename } from "./ebbfile.js";

const ANALYTICS_PANEL_ID = "insights-analytics";
const EVIDENCE_PANEL_ID = "insights-evidence";
const SVG_NS = "http://www.w3.org/2000/svg";
const TAGS = ["aff", "neg", "link", "impact", "framing", "card of the round"];

// re-render at most ~3x/sec: a timer tick or a fast typist can fire
// round:change dozens of times a second, and redrawing SVGs on every one
// of them is wasted work nobody can perceive.
const RENDER_MS = 320;
// evidence field edits: batch keystrokes across a short pause before we
// touch the undo stack, so "typing an author name" is one commit, not one
// per character.
const PERSIST_MS = 400;

let analyticsRoot = null;
let evidenceRoot = null;
let subscribed = false;

// pending per-card patches, flushed by a debounced commit keyed on card id
// so editing two different cards' fields in the same window doesn't clobber
// either one's pending edits.
const pendingPatches = new Map();
const flushers = new Map();

// ---------------------------------------------------------------------------
// Pure analysis — analyze() and its helpers touch no DOM and take/return
// plain data, so a Node script can exercise them without a browser.
// ---------------------------------------------------------------------------

/** Word count of a cell's text; empty/whitespace-only text is zero words. */
function wordCount(text) {
    const t = String(text ?? "").trim();
    return t ? t.split(/\s+/).length : 0;
}

function hasText(v) {
    return v !== null && v !== undefined && String(v).trim() !== "";
}

/** a/b as a percentage rounded to one decimal, or null when b is zero (nothing to divide). */
function pct(a, b) {
    return b > 0 ? Math.round((a / b) * 1000) / 10 : null;
}

function sheetTitleById(sheets, id) {
    return sheets.find((s) => s.id === id)?.title ?? id;
}

/**
 * Compute every number and series the two panels render, from a plain round
 * object. Never mutates `round`. Safe to call on `undefined`/a brand-new
 * round with no sheets — every field degrades to zero/empty rather than
 * throwing, which is what lets the panels show an honest empty state.
 *
 * @param {object} round
 * @returns {{
 *   meta: {event: string, firstSide: string, hasTimeline: boolean, hasData: boolean},
 *   speeches: Array<{id:string, name:string, short:string, side:string,
 *     limitSeconds:number, usedSeconds:number, overUnder:number|null, lines:number, words:number}>,
 *   coverage: {aff:{made:number,answered:number,pct:number|null}, neg:{made:number,answered:number,pct:number|null}},
 *   dropped: {aff:{total:number,bySheet:Array<{sheetId:string,title:string,count:number}>},
 *             neg:{total:number,bySheet:Array<{sheetId:string,title:string,count:number}>}},
 *   cards: {aff:{read:number,starred:number,flagged:number,kicked:number},
 *           neg:{read:number,starred:number,flagged:number,kicked:number}},
 *   density: Array<{sheetId:string,title:string,side:string,columns:Array<{id:string,short:string,side:string,density:number}>}>,
 *   pace: Array<{ts:number,sheetId:string,row:number,col:number,side:string,speechId:string}>,
 *   sheets: Array<{id:string,title:string,side:string,rowsUsed:number,columnsTouched:number,dropped:number}>,
 * }}
 */
export function analyze(round) {
    const safeRound = round && typeof round === "object" ? round : { sheets: [] };
    const eventId = safeRound.event ?? "policy";
    const firstSide = safeRound.firstSide ?? "aff";
    const timeline = safeRound.cascade?.timeline ?? [];
    const sheets = sortedSheets(safeRound);

    // --- per-speech timing + lines/words, from the round's full speech order ---
    // speechOrder() takes the resolved EventDef, not the bare id string —
    // model.js's sheetColumns() does the same lookup for the same reason.
    const speeches = speechOrder(getEvent(eventId), firstSide).map((sp) => {
        const entries = timeline.filter((t) => t.speechId === sp.id);
        const usedSeconds = entries.reduce((sum, t) => sum + (t.seconds ?? 0), 0);
        let lines = 0;
        let words = 0;
        for (const sheet of sheets) {
            if (sheet.kind === "cx") continue; // CX columns never share ids with real speeches
            const cols = sheetColumns(safeRound, sheet);
            const ci = cols.findIndex((c) => c.id === sp.id);
            if (ci === -1) continue;
            for (const row of sheet.data ?? []) {
                const text = row?.[ci];
                if (hasText(text)) {
                    lines++;
                    words += wordCount(text);
                }
            }
        }
        return {
            id: sp.id,
            name: sp.name,
            short: sp.short,
            side: sp.side,
            limitSeconds: speechSeconds(eventId, sp.id),
            usedSeconds,
            // null means "not timed yet" — distinct from 0, which would claim
            // the speech ran exactly on time.
            overUnder: entries.length ? usedSeconds - speechSeconds(eventId, sp.id) : null,
            lines,
            words,
        };
    });

    // --- coverage / dropped / cards / density / pace, one pass per sheet ---
    const coverage = { aff: { made: 0, answered: 0 }, neg: { made: 0, answered: 0 } };
    const droppedTotals = { aff: 0, neg: 0 };
    const droppedBySheet = { aff: new Map(), neg: new Map() };
    const cards = {
        aff: { read: 0, starred: 0, flagged: 0, kicked: 0 },
        neg: { read: 0, starred: 0, flagged: 0, kicked: 0 },
    };
    const pace = [];
    const density = [];
    const sheetRows = [];

    for (const sheet of sheets) {
        const cols = sheetColumns(safeRound, sheet);
        const data = sheet.data ?? [];
        const rowsUsed = data.length;
        const touchedCols = new Set();
        let sheetDropped = 0;
        // Shared with the dropped-argument radar so the two never disagree
        // about what counts as a drop. See happenedColumns() in model.js.
        const hasHappened = happenedColumns(safeRound, sheet, cols);

        const colDensities = cols.map((col, ci) => {
            let nonEmpty = 0;
            for (const row of data) if (hasText(row?.[ci])) nonEmpty++;
            if (nonEmpty > 0) touchedCols.add(ci);
            return {
                id: col.id,
                short: col.short ?? col.name ?? col.id,
                side: col.side,
                density: rowsUsed ? nonEmpty / rowsUsed : 0,
            };
        });

        for (let ci = 0; ci < cols.length; ci++) {
            const side = cols[ci].side;
            if (side !== "aff" && side !== "neg") continue; // no side to attribute to (e.g. an undefined CX slot)
            for (let ri = 0; ri < data.length; ri++) {
                const text = data[ri]?.[ci];
                if (!hasText(text)) continue;
                const meta = getMeta(sheet, ri, ci) ?? {};

                if (meta.card) cards[side].read++;
                if (meta.cascade?.star) cards[side].starred++;
                if (meta.cascade?.flagged) cards[side].flagged++;
                if (meta.kicked) cards[side].kicked++;
                if (meta.cascade?.ts) {
                    pace.push({ ts: meta.cascade.ts, sheetId: sheet.id, row: ri, col: ci, side, speechId: cols[ci].id });
                }

                // Coverage/dropped model an argument-and-response chain, which
                // a CX sheet's Q&A columns don't represent; a kicked argument
                // is intentionally dead, not dropped; and there must be a next
                // column to answer into at all.
                if (sheet.kind === "cx") continue;
                if (ci >= cols.length - 1) continue;
                if (meta.kicked) continue;
                // An argument whose answering speech has not happened yet is
                // neither answered nor dropped; counting it as made would drag
                // coverage down for a round still in progress.
                if (!hasHappened(ci + 1)) continue;
                coverage[side].made++;
                const nextText = data[ri]?.[ci + 1];
                if (hasText(nextText)) {
                    coverage[side].answered++;
                } else {
                    droppedTotals[side]++;
                    sheetDropped++;
                    droppedBySheet[side].set(sheet.id, (droppedBySheet[side].get(sheet.id) ?? 0) + 1);
                }
            }
        }

        density.push({ sheetId: sheet.id, title: sheet.title, side: sheet.group, columns: colDensities });
        sheetRows.push({
            id: sheet.id,
            title: sheet.title,
            side: sheet.group,
            rowsUsed,
            columnsTouched: touchedCols.size,
            dropped: sheetDropped,
        });
    }

    pace.sort((a, b) => a.ts - b.ts);

    const bySheetList = (map) =>
        [...map].map(([sheetId, count]) => ({ sheetId, title: sheetTitleById(sheets, sheetId), count }));

    return {
        meta: {
            event: eventId,
            firstSide,
            hasTimeline: timeline.length > 0,
            hasData: sheets.some((s) => (s.data ?? []).some((row) => Array.isArray(row) && row.some(hasText))),
        },
        speeches,
        coverage: {
            aff: { ...coverage.aff, pct: pct(coverage.aff.answered, coverage.aff.made) },
            neg: { ...coverage.neg, pct: pct(coverage.neg.answered, coverage.neg.made) },
        },
        dropped: {
            aff: { total: droppedTotals.aff, bySheet: bySheetList(droppedBySheet.aff) },
            neg: { total: droppedTotals.neg, bySheet: bySheetList(droppedBySheet.neg) },
        },
        cards,
        density,
        pace,
        sheets: sheetRows,
    };
}

/**
 * A likely author + year out of a card's raw text, e.g. "Bostrom 14" or
 * "Smith '22" — the shorthand debaters actually write on a flow. Returns
 * empty strings when nothing looks like a cite tag; callers must never let
 * this overwrite a value the user already typed.
 */
function parseAuthorYear(text) {
    const m = String(text ?? "").match(/([A-Z][A-Za-z'-]{1,})\s+['’]?(\d{2}|\d{4})\b/);
    if (!m) return { author: "", year: "" };
    let year = m[2];
    if (year.length === 2) {
        // "which century" guess a debater makes on sight of a two-digit cite.
        year = (Number(year) <= 49 ? "20" : "19") + year;
    }
    return { author: m[1], year };
}

/**
 * Every cell marked `meta.card`, merged with saved detail from
 * `round.cascade.evidence`. Pure and DOM-free like `analyze()`, so the
 * evidence panel is just a renderer over this list.
 */
function collectCards(round) {
    const safeRound = round && typeof round === "object" ? round : { sheets: [] };
    const saved = new Map((safeRound.cascade?.evidence ?? []).map((e) => [e.id, e]));
    const sheets = sortedSheets(safeRound);
    const cards = [];
    for (const sheet of sheets) {
        const cols = sheetColumns(safeRound, sheet);
        const data = sheet.data ?? [];
        for (let ri = 0; ri < data.length; ri++) {
            const row = data[ri] ?? [];
            for (let ci = 0; ci < row.length; ci++) {
                const meta = getMeta(sheet, ri, ci);
                if (!meta?.card) continue;
                const text = row[ci] ?? "";
                const id = `${sheet.id}:${ri},${ci}`;
                const prior = saved.get(id) ?? {};
                const guess = parseAuthorYear(text);
                cards.push({
                    id,
                    sheetId: sheet.id,
                    sheetTitle: sheet.title,
                    side: cols[ci]?.side ?? sheet.group,
                    row: ri,
                    col: ci,
                    text,
                    author: prior.author ?? guess.author,
                    year: prior.year ?? guess.year,
                    publication: prior.publication ?? "",
                    url: prior.url ?? "",
                    tag: prior.tag ?? "",
                    strength: prior.strength ?? null,
                });
            }
        }
    }
    return cards;
}

/** Cards split into aff/neg, each sorted by tag then sheet — how a cite sheet reads. */
function groupCards(cards) {
    const groups = { aff: [], neg: [] };
    for (const c of cards) (c.side === "neg" ? groups.neg : groups.aff).push(c);
    for (const list of Object.values(groups)) {
        list.sort((a, b) => (a.tag || "zzz").localeCompare(b.tag || "zzz") || a.sheetTitle.localeCompare(b.sheetTitle));
    }
    return groups;
}

function citeLine(card) {
    const author = card.author || "Unknown";
    const year = card.year || "n.d.";
    const pub = card.publication ? ` — ${card.publication}` : "";
    const url = card.url ? ` (${card.url})` : "";
    return `${author} ${year}${pub}${url}`;
}

/** Markdown cite sheet: grouped by side then tag, cite line + indented card body. */
function buildCiteSheetMarkdown(cards) {
    const groups = groupCards(cards);
    const lines = ["# Cite sheet", ""];
    for (const side of ["aff", "neg"]) {
        if (!groups[side].length) continue;
        lines.push(`## ${side.toUpperCase()}`, "");
        let tag = null;
        for (const c of groups[side]) {
            const t = c.tag || "untagged";
            if (t !== tag) {
                tag = t;
                lines.push(`### ${tag}`, "");
            }
            lines.push(`- **${citeLine(c)}**`);
            const body = (c.text || "").split("\n").join("\n  > ");
            lines.push(`  > ${body}`, "");
        }
    }
    return lines.join("\n");
}

/** Plain-text cite sheet for pasting where Markdown won't render (a subject line, a text field). */
function buildCiteSheetText(cards) {
    const groups = groupCards(cards);
    const lines = [];
    for (const side of ["aff", "neg"]) {
        if (!groups[side].length) continue;
        lines.push(side.toUpperCase(), "=".repeat(side.length));
        let tag = null;
        for (const c of groups[side]) {
            const t = c.tag || "untagged";
            if (t !== tag) {
                tag = t;
                lines.push("", tag.toUpperCase());
            }
            lines.push(citeLine(c));
            const body = (c.text || "")
                .split("\n")
                .map((l) => `    ${l}`)
                .join("\n");
            lines.push(body, "");
        }
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hand-built inline SVG. No chart library: these are small, purpose-built
// shapes, and a library would cost more to theme through CSS custom
// properties than it saves.
// ---------------------------------------------------------------------------

function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

/** Time used vs. official limit, one bar per speech in round order. */
function buildTimeChart(speeches) {
    const W = 640;
    const H = 200;
    const padL = 8;
    const padR = 8;
    const padT = 12;
    const padB = 24;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const maxSec = Math.max(60, ...speeches.map((s) => Math.max(s.limitSeconds, s.usedSeconds)));
    const n = Math.max(1, speeches.length);
    const colW = plotW / n;
    const barW = Math.min(28, colW * 0.5);

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "insights-chart", role: "img" }, [
        svg("title", {}, "Speech time used versus the official limit, in seconds"),
        svg("line", {
            x1: padL,
            y1: H - padB,
            x2: W - padR,
            y2: H - padB,
            stroke: "var(--d1-accent)",
            "stroke-width": 1,
            opacity: 0.5,
        }),
    ]);

    speeches.forEach((sp, i) => {
        const cx = padL + colW * i + colW / 2;
        const limitH = (sp.limitSeconds / maxSec) * plotH;
        const usedH = (sp.usedSeconds / maxSec) * plotH;
        const over = sp.overUnder !== null && sp.overUnder > 0;
        const sideColor = sp.side === "neg" ? "var(--neg)" : "var(--aff)";
        const untimed = sp.overUnder === null;
        const titleText = untimed
            ? `${sp.short}: not timed yet (limit ${fmtClock(sp.limitSeconds)})`
            : `${sp.short}: ${fmtClock(sp.usedSeconds)} used of ${fmtClock(sp.limitSeconds)} limit, ` +
              (sp.overUnder > 0
                  ? `${fmtClock(sp.overUnder)} over`
                  : sp.overUnder < 0
                    ? `${fmtClock(-sp.overUnder)} under`
                    : "right on time");

        root.append(
            svg("g", {}, [
                svg("title", {}, titleText),
                svg("line", {
                    x1: cx - barW / 2 - 4,
                    x2: cx + barW / 2 + 4,
                    y1: H - padB - limitH,
                    y2: H - padB - limitH,
                    stroke: "var(--d1-accent-2)",
                    "stroke-width": 2,
                    "stroke-dasharray": "3,2",
                }),
                svg("rect", {
                    x: cx - barW / 2,
                    y: H - padB - (untimed ? 0 : usedH),
                    width: barW,
                    height: untimed ? 0 : Math.max(0, usedH),
                    fill: over ? "var(--neg)" : sideColor,
                    opacity: untimed ? 0.25 : 0.9,
                    rx: 2,
                }),
                svg(
                    "text",
                    { x: cx, y: H - padB + 15, "text-anchor": "middle", class: "insights-axis-label" },
                    sp.short,
                ),
            ]),
        );
    });

    return root;
}

/** Two horizontal bars: answered share of arguments made, per side. */
function buildCoverageChart(coverage) {
    const W = 420;
    const H = 88;
    const padL = 40;
    const padR = 46;
    const barH = 22;
    const gap = 18;
    const full = W - padL - padR;

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "insights-chart", role: "img" }, [
        svg("title", {}, "Coverage: arguments answered versus arguments made, by side"),
    ]);

    ["aff", "neg"].forEach((side, i) => {
        const c = coverage[side];
        const y = 6 + i * (barH + gap);
        const answeredW = c.made ? (c.answered / c.made) * full : 0;
        root.append(
            svg("text", { x: 0, y: y + barH / 2 + 4, class: "insights-axis-label" }, side.toUpperCase()),
            svg("rect", { x: padL, y, width: full, height: barH, fill: "var(--d1-navy)", opacity: 0.35, rx: 4 }),
            svg(
                "rect",
                { x: padL, y, width: answeredW, height: barH, fill: `var(--${side})`, rx: 4 },
                [svg("title", {}, `${side}: ${c.answered} of ${c.made} answered (${c.pct === null ? "n/a" : c.pct + "%"})`)],
            ),
            svg("text", { x: padL + full + 6, y: y + barH / 2 + 4, class: "insights-axis-label" }, c.pct === null ? "—" : `${c.pct}%`),
        );
    });

    return root;
}

/** One column-density line per sheet — a quick "where did the ink go" sparkline. */
function buildSparkline(columns, side) {
    const W = 160;
    const H = 32;
    const pad = 3;
    const n = columns.length;
    const summary = columns.map((c) => `${c.short} ${Math.round(c.density * 100)}%`).join(", ");
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "insights-spark", role: "img" }, [
        svg("title", {}, `Column density — ${summary || "no columns"}`),
    ]);
    if (n === 0) return root;

    const stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
    const points = columns.map((c, i) => {
        const x = pad + i * stepX;
        const y = H - pad - c.density * (H - pad * 2);
        return [x, y];
    });
    root.append(
        svg("polyline", {
            points: points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
            fill: "none",
            stroke: side === "neg" ? "var(--neg)" : side === "aff" ? "var(--aff)" : "var(--d1-accent-2)",
            "stroke-width": 2,
        }),
    );
    for (const [x, y] of points) {
        root.append(svg("circle", { cx: x, cy: y, r: 2, fill: "var(--d1-accent)" }));
    }
    return root;
}

/** Cumulative cells typed over the round's wall-clock span — a pacing curve. */
function buildPaceChart(pace) {
    const W = 640;
    const H = 120;
    const padL = 8;
    const padR = 8;
    const padT = 10;
    const padB = 8;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "insights-chart", role: "img" }, [
        svg("title", {}, "Flow pace: cells typed over the course of the round"),
    ]);
    if (!pace.length) return root;

    const t0 = pace[0].ts;
    const span = Math.max(1, pace[pace.length - 1].ts - t0);
    const points = pace.map((p, i) => {
        const x = padL + ((p.ts - t0) / span) * plotW;
        const y = padT + plotH - ((i + 1) / pace.length) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    root.append(
        svg("line", { x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, stroke: "var(--d1-accent)", opacity: 0.4 }),
        svg("polyline", { points: points.join(" "), fill: "none", stroke: "var(--d1-accent-2)", "stroke-width": 2 }),
    );
    return root;
}

// ---------------------------------------------------------------------------
// Panel A — Round Analytics
// ---------------------------------------------------------------------------

function emptyState(text) {
    return el("div.insights-empty", { text });
}

function section(title, ...body) {
    return el("section.insights-section", {}, el("h4", { text: title }), ...body);
}

function statTile(label, value) {
    return el("div.insights-stat", {}, el("div.insights-stat-value", { text: String(value) }), el("div.insights-stat-label", { text: label }));
}

function sectionDropped(dropped) {
    const rows = [];
    for (const side of ["aff", "neg"]) {
        for (const d of dropped[side].bySheet) rows.push({ side, ...d });
    }
    const body = rows.length
        ? rows.map((r) =>
              el(
                  "tr",
                  {},
                  el("td", { text: r.side.toUpperCase() }),
                  el("td", { text: r.title }),
                  el("td", { text: String(r.count) }),
              ),
          )
        : el("tr", {}, el("td", { colspan: 3, text: "No dropped arguments detected." }));
    return section(
        `Dropped arguments — AFF ${dropped.aff.total}, NEG ${dropped.neg.total}`,
        el(
            "table.insights-table",
            {},
            el("thead", {}, el("tr", {}, el("th", { text: "Side" }), el("th", { text: "Sheet" }), el("th", { text: "Count" }))),
            el("tbody", {}, body),
        ),
    );
}

function sectionCards(cards) {
    return section(
        "Cards & flags",
        el(
            "div.insights-stats",
            {},
            statTile("AFF cards", cards.aff.read),
            statTile("NEG cards", cards.neg.read),
            statTile("Starred", cards.aff.starred + cards.neg.starred),
            statTile("Flagged", cards.aff.flagged + cards.neg.flagged),
            statTile("Kicked", cards.aff.kicked + cards.neg.kicked),
        ),
    );
}

function sectionDensity(density) {
    if (!density.length) return null;
    return section(
        "Column density",
        el(
            "div.insights-density-list",
            {},
            density.map((d) => el("div.insights-density-row", {}, el("span.insights-density-label", { text: d.title }), buildSparkline(d.columns, d.side))),
        ),
    );
}

function sectionSheets(sheets) {
    return section(
        "Sheets",
        el(
            "table.insights-table",
            {},
            el(
                "thead",
                {},
                el(
                    "tr",
                    {},
                    el("th", { text: "Sheet" }),
                    el("th", { text: "Side" }),
                    el("th", { text: "Rows" }),
                    el("th", { text: "Cols touched" }),
                    el("th", { text: "Dropped" }),
                ),
            ),
            el(
                "tbody",
                {},
                sheets.length
                    ? sheets.map((s) =>
                          el(
                              "tr",
                              {},
                              el("td", { text: s.title }),
                              el("td", { text: (s.side || "—").toUpperCase() }),
                              el("td", { text: String(s.rowsUsed) }),
                              el("td", { text: String(s.columnsTouched) }),
                              el("td", { text: String(s.dropped) }),
                          ),
                      )
                    : el("tr", {}, el("td", { colspan: 5, text: "No sheets yet." })),
            ),
        ),
    );
}

function renderAnalyticsPanel(root) {
    if (!root) return;
    const data = analyze(store.round);
    clear(root);

    if (!data.meta.hasData) {
        root.append(emptyState("No flow yet. Once speeches are flowed and timed, analytics appear here automatically."));
        return;
    }

    // Native Element.append() (unlike this file's el() helper) stringifies a
    // null argument into a literal "null" text node instead of skipping it,
    // so sectionDensity()'s possible null and the conditional pace section
    // must be filtered out before they reach it.
    root.append(
        ...[
            section(
                "Speech time",
                buildTimeChart(data.speeches),
                el("p.insights-note", { text: "Dashed tick = official limit. Bar = time used; red means over time." }),
            ),
            section("Coverage", buildCoverageChart(data.coverage)),
            sectionDropped(data.dropped),
            sectionCards(data.cards),
            sectionDensity(data.density),
            data.pace.length ? section("Pace", buildPaceChart(data.pace)) : null,
            sectionSheets(data.sheets),
            el(
                "div.insights-actions",
                {},
                el("button.insights-btn.primary", { type: "button", onclick: () => openReport(), text: "Post-round report" }),
            ),
        ].filter(Boolean),
    );
}

// --- printable post-round report -------------------------------------------

function buildReportHTML(round, data) {
    const scouting = round?.scouting ?? {};
    const decision = scouting.decision ?? {};
    const notes = round?.cascade?.notes ?? "";
    const title = suggestFilename(round).replace(/\.ebb$/i, "");

    const speechRows =
        data.speeches
            .map((s) => {
                const overCls = s.overUnder > 0 ? "over" : s.overUnder < 0 ? "under" : "";
                const overText = s.overUnder === null ? "—" : `${s.overUnder > 0 ? "+" : ""}${fmtClock(s.overUnder)}`;
                return `<tr><td>${esc(s.short)}</td><td>${esc((s.side || "—").toUpperCase())}</td><td>${fmtClock(s.limitSeconds)}</td><td>${s.usedSeconds ? fmtClock(s.usedSeconds) : "—"}</td><td class="${overCls}">${overText}</td><td>${s.lines}</td><td>${s.words}</td></tr>`;
            })
            .join("") || `<tr><td colspan="7">No speeches timed yet.</td></tr>`;

    const droppedRows =
        ["aff", "neg"]
            .flatMap((side) => data.dropped[side].bySheet.map((d) => `<tr><td>${side.toUpperCase()}</td><td>${esc(d.title)}</td><td>${d.count}</td></tr>`))
            .join("") || `<tr><td colspan="3">No dropped arguments detected.</td></tr>`;

    const fmtPct = (c) => (c.pct === null ? "—" : `${c.pct}%`);

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)} — Post-round report</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 2rem; }
  h1 { font-size: 20px; margin-bottom: 0.2em; }
  h2 { font-size: 15px; margin-top: 1.6em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5em; font-size: 13px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ddd; }
  .meta { color: #555; font-size: 13px; }
  .over { color: #b3261e; font-weight: 600; }
  .under { color: #1a7f37; }
  .notes { white-space: pre-wrap; background: #f6f6f6; padding: 0.8em; border-radius: 6px; }
  .print-btn { position: fixed; top: 1em; right: 1em; font: inherit; padding: 0.4em 0.8em; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print</button>
<h1>${esc(title)}</h1>
<p class="meta">
  ${esc(scouting.tournament || "")} ${esc(scouting.round ? `Round ${scouting.round}` : "")} ${esc(scouting.flight || "")} — ${esc(scouting.date || "")}<br>
  Judge: ${esc(scouting.judge || "—")}${decision.vote ? ` — Decision: ${esc(String(decision.vote).toUpperCase())}` : ""}
</p>
<h2>Speech timing</h2>
<table><thead><tr><th>Speech</th><th>Side</th><th>Limit</th><th>Used</th><th>Over/Under</th><th>Lines</th><th>Words</th></tr></thead><tbody>${speechRows}</tbody></table>
<h2>Coverage</h2>
<table><thead><tr><th>Side</th><th>Answered</th><th>Made</th><th>Coverage</th></tr></thead><tbody>
<tr><td>AFF</td><td>${data.coverage.aff.answered}</td><td>${data.coverage.aff.made}</td><td>${fmtPct(data.coverage.aff)}</td></tr>
<tr><td>NEG</td><td>${data.coverage.neg.answered}</td><td>${data.coverage.neg.made}</td><td>${fmtPct(data.coverage.neg)}</td></tr>
</tbody></table>
<h2>Dropped arguments</h2>
<table><thead><tr><th>Side</th><th>Sheet</th><th>Count</th></tr></thead><tbody>${droppedRows}</tbody></table>
<h2>Cards read</h2>
<p>AFF: ${data.cards.aff.read} &nbsp; NEG: ${data.cards.neg.read} &nbsp; Starred: ${data.cards.aff.starred + data.cards.neg.starred}</p>
<h2>RFD / notes</h2>
<div class="notes">${esc(notes) || "(none recorded)"}</div>
</body>
</html>`;
}

/** Opens the printable post-round report in a new window with its own minimal stylesheet. */
function openReport() {
    const round = store.round;
    const data = analyze(round);
    const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    if (!win) {
        ui.toast("Allow popups to open the printable report.", { type: "warn" });
        return;
    }
    win.document.write(buildReportHTML(round, data));
    win.document.close();
}

// ---------------------------------------------------------------------------
// Panel B — Evidence Tracker
// ---------------------------------------------------------------------------

function textField(label, value, onChange) {
    const input = el("input.insights-field-input", {
        type: "text",
        value: value ?? "",
        "aria-label": label,
        oninput: (e) => onChange(e.target.value),
    });
    return el("label.insights-field", {}, el("span.insights-field-label", { text: label }), input);
}

function tagSelect(value, onChange) {
    const select = el(
        "select.insights-field-input",
        { "aria-label": "Tag", onchange: (e) => onChange(e.target.value) },
        el("option", { value: "", selected: !value }, "— tag —"),
        TAGS.map((t) => el("option", { value: t, selected: value === t }, t)),
    );
    return el("label.insights-field", {}, el("span.insights-field-label", { text: "Tag" }), select);
}

function strengthPicker(value, onChange) {
    const wrap = el("div.insights-strength", { role: "radiogroup", "aria-label": "Strength" });
    for (const n of [1, 2, 3]) {
        wrap.append(
            el("button.insights-strength-btn", {
                type: "button",
                class: value === n ? "active" : "",
                // el()'s prop setter treats a bare `false` as "omit the
                // attribute", not "write aria-pressed=false" — stringify so
                // the unselected buttons still announce a state.
                "aria-pressed": value === n ? "true" : "false",
                onclick: () => onChange(value === n ? null : n),
                text: String(n),
            }),
        );
    }
    return wrap;
}

/** Batches per-field edits and commits them into round.cascade.evidence, debounced per card id. */
function persist(id, patch) {
    const acc = pendingPatches.get(id) ?? {};
    Object.assign(acc, patch);
    pendingPatches.set(id, acc);

    let flush = flushers.get(id);
    if (!flush) {
        flush = debounce(() => {
            const p = pendingPatches.get(id);
            pendingPatches.delete(id);
            if (p) commitEvidence(id, p);
        }, PERSIST_MS);
        flushers.set(id, flush);
    }
    flush();
}

function commitEvidence(id, patch) {
    store.commit(
        (round) => {
            const cascade = ensureCascade(round);
            const idx = cascade.evidence.findIndex((e) => e.id === id);
            if (idx >= 0) {
                Object.assign(cascade.evidence[idx], patch);
            } else {
                const [sheetId, rc] = id.split(":");
                const [row, col] = rc.split(",").map(Number);
                cascade.evidence.push({
                    id,
                    sheetId,
                    row,
                    col,
                    cite: "",
                    author: "",
                    year: "",
                    url: "",
                    tag: "",
                    strength: null,
                    ...patch,
                });
            }
        },
        { label: "Edit evidence", coalesce: `insights:evidence:${id}`, silent: true },
    );
}

function cardRow(card) {
    const jump = el(
        "button.insights-card-jump",
        {
            type: "button",
            "aria-label": `Jump to ${card.sheetTitle}, row ${card.row + 1}`,
            onclick: () => bus.emit("grid:goto", { sheetId: card.sheetId, row: card.row, col: card.col }),
        },
        `${card.sheetTitle} · ${card.side === "neg" ? "NEG" : "AFF"}`,
    );

    return el(
        "div.insights-card",
        { dataset: { id: card.id } },
        el("div.insights-card-head", {}, jump),
        el("div.insights-card-body", { text: card.text || "(empty cell)" }),
        el(
            "div.insights-card-fields",
            {},
            textField("Author", card.author, (v) => persist(card.id, { author: v })),
            textField("Year", card.year, (v) => persist(card.id, { year: v })),
            textField("Publication", card.publication, (v) => persist(card.id, { publication: v })),
            textField("URL", card.url, (v) => persist(card.id, { url: v })),
            tagSelect(card.tag, (v) => persist(card.id, { tag: v })),
            strengthPicker(card.strength, (v) => persist(card.id, { strength: v })),
        ),
    );
}

function baseFileName(round) {
    return suggestFilename(round).replace(/\.ebb$/i, "");
}

function exportCiteSheet(format) {
    const cards = collectCards(store.round);
    if (!cards.length) {
        ui.toast("No cards to export yet.", { type: "warn" });
        return;
    }
    const name = baseFileName(store.round);
    if (format === "txt") {
        download(`${name} — cite sheet.txt`, buildCiteSheetText(cards), "text/plain");
    } else {
        download(`${name} — cite sheet.md`, buildCiteSheetMarkdown(cards), "text/markdown");
    }
}

function copyCiteSheet() {
    const cards = collectCards(store.round);
    if (!cards.length) {
        ui.toast("No cards to copy yet.", { type: "warn" });
        return;
    }
    if (!navigator.clipboard?.writeText) {
        ui.toast("Clipboard isn't available here; use the export buttons instead.", { type: "warn" });
        return;
    }
    navigator.clipboard.writeText(buildCiteSheetText(cards)).then(
        () => ui.toast("Cite sheet copied — paste it into your post-round email.", { type: "success" }),
        () => ui.toast("Couldn't copy to clipboard.", { type: "error" }),
    );
}

function renderEvidencePanel(root) {
    if (!root) return;
    const cards = collectCards(store.round);

    // ui.js is written concurrently with this module; guard the call so a
    // panel doesn't crash if setPanelBadge hasn't landed yet.
    if (typeof ui.setPanelBadge === "function") ui.setPanelBadge(EVIDENCE_PANEL_ID, cards.length);

    clear(root);
    if (!cards.length) {
        root.append(emptyState(`No cards marked yet. Press ${MOD_LABEL}+T on a cell to mark it as a card, and it will show up here.`));
        return;
    }

    root.append(
        el(
            "div.insights-toolbar",
            {},
            el("button.insights-btn", { type: "button", onclick: () => exportCiteSheet("md"), text: "Export Markdown" }),
            el("button.insights-btn", { type: "button", onclick: () => exportCiteSheet("txt"), text: "Export text" }),
            el("button.insights-btn", { type: "button", onclick: () => copyCiteSheet(), text: "Copy for email" }),
        ),
    );

    const groups = groupCards(cards);
    for (const side of ["aff", "neg"]) {
        if (!groups[side].length) continue;
        root.append(
            el("h4.insights-side-heading", { text: `${side.toUpperCase()} — ${groups[side].length} card${groups[side].length === 1 ? "" : "s"}` }),
            ...groups[side].map(cardRow),
        );
    }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function ensureSubscriptions() {
    if (subscribed) return;
    subscribed = true;
    const rerenderAnalytics = debounce(() => renderAnalyticsPanel(analyticsRoot), RENDER_MS);
    const rerenderEvidence = debounce(() => renderEvidencePanel(evidenceRoot), RENDER_MS);
    // one debounced handler covers both panels; each guards on its own root
    // being mounted, so it's harmless to fire before a panel is shown.
    bus.on("round:change", () => {
        rerenderAnalytics();
        rerenderEvidence();
    });
    bus.on("timer:tick", () => {
        rerenderAnalytics();
        rerenderEvidence();
    });
}

/** Registers the Analytics and Evidence dock panels and their commands. Call once at boot. */
export function init() {
    ensureSubscriptions();

    register({
        id: "insights.openAnalytics",
        title: "Open round analytics",
        category: "Analytics",
        icon: "\u{1F4CA}",
        run: () => ui.showPanel(ANALYTICS_PANEL_ID),
    });
    register({
        id: "insights.openEvidence",
        title: "Open evidence tracker",
        category: "Analytics",
        icon: "\u{1F5C2}",
        run: () => ui.showPanel(EVIDENCE_PANEL_ID),
    });
    register({
        id: "insights.report",
        title: "Post-round report",
        category: "Analytics",
        icon: "\u{1F5A8}",
        run: () => openReport(),
    });
    register({
        id: "insights.exportCites",
        title: "Export cite sheet (Markdown)",
        category: "Analytics",
        icon: "⬇",
        run: () => exportCiteSheet("md"),
    });

    ui.registerPanel({
        id: ANALYTICS_PANEL_ID,
        title: "Analytics",
        icon: "\u{1F4CA}",
        order: 510,
        mount: (host) => {
            analyticsRoot = el("div.insights-panel.insights-analytics");
            host.append(analyticsRoot);
            renderAnalyticsPanel(analyticsRoot);
        },
        onShow: () => renderAnalyticsPanel(analyticsRoot),
    });
    ui.registerPanel({
        id: EVIDENCE_PANEL_ID,
        title: "Evidence",
        icon: "\u{1F5C2}",
        order: 520,
        mount: (host) => {
            evidenceRoot = el("div.insights-panel.insights-evidence");
            host.append(evidenceRoot);
            renderEvidencePanel(evidenceRoot);
        },
        onShow: () => renderEvidencePanel(evidenceRoot),
    });
}

export const insights = { init, analyze };
export default insights;
