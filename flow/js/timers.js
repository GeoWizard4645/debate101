/**
 * Cascade — FEATURE 1: Round Clock.
 *
 * Every debate timer app a debater has ever used gets one thing wrong: it
 * loses seconds when the laptop lid flickers or the tab loses focus, because
 * it decrements a counter once per tick instead of reading the clock. This
 * module never subtracts per frame. Every running clock stores only a frozen
 * "accumulated" duration plus the `performance.now()` timestamp of its last
 * resume; the displayed value is always *recomputed* from that anchor, so a
 * backgrounded tab (rAF stalls, `setInterval` keeps firing but coarsely)
 * never drifts — the next tick just recomputes the true elapsed time in one
 * step instead of replaying however many ticks were missed.
 *
 * Owns: the speech clock (counts down, then up past zero — a debater who
 * goes over needs the flow to say by how much), two prep clocks (one side
 * runs at a time), a cross-ex clock, the HUD overlay, the dock panel, and
 * the round timeline persisted to `round.cascade.timeline` / `.prep`.
 */

import { bus } from "./bus.js";
import { el, clear, fmtClock } from "./dom.js";
import { register } from "./registry.js";
import {
    getEvent,
    sideLabels,
    speechOrder,
    speechSeconds,
    PREP_SECONDS,
    CX_SECONDS,
    TIMER_PRESETS,
} from "./events.js";
import { ensureCascade, sheetColumns } from "./model.js";
import { store } from "./store.js";
import { ui } from "./ui.js";

const PANEL_ID = "timers";
const TOOLBAR_ID = "timer.clock";

// Bus emits are throttled so panels that redraw on `timer:tick` don't run
// their own rAF loop — this is the one loop, everyone else just listens.
const TICK_EMIT_MS = 250; // ~4/sec, per spec
const RENDER_MS = 200; // HUD/panel text repaint cadence; smoother is wasted work
const PREP_PERSIST_MS = 15000; // safety-net autosave while prep runs; see persistPrepNow()

// --- State ---------------------------------------------------------------
// Nothing here is ever decremented per tick. `accumMs`/`remainingMs` are the
// frozen value as of the last pause; `runStartPerf` anchors the live portion.

/** @type {{eventId:string, index:number, speechId:string|null, side:string|null,
 *  limitSeconds:number, accumMs:number, running:boolean, runStartPerf:number|null,
 *  startedAtWall:number|null, alerted60:boolean, alerted30:boolean, alertedOver:boolean}} */
let speech = freshSpeechState();

let prep = { aff: freshPrepState(0), neg: freshPrepState(0) };

let cx = freshCxState(0);

let speechOrderList = [];
let preset = null; // active TIMER_PRESETS entry, or null for the event default
let lastRoundId = null;

let muted = false;
let signals = { sixty: false, thirty: true };

// --- Engine (rAF, falling back to setInterval while the tab is hidden) ---

let engineActive = false;
let rafId = null;
let intervalId = null;
let lastTickEmit = 0;
let lastRenderAt = 0;
let lastPrepPersist = 0;

// --- HUD DOM refs ----------------------------------------------------------

let hudRoot = null;
let hudDragHandle = null;
let hudCollapseBtn = null;
let hudSpeechLabel = null;
let hudClock = null;
let hudPrepRow = null;
let hudPrepAff = null;
let hudPrepNeg = null;
let hudCollapsed = false;

// --- Panel DOM refs ----------------------------------------------------------

let panelVisible = false;
let panelSpeechLabel = null;
let panelClock = null;
let panelStartStopBtn = null;
let panelPresetSelect = null;
let panelSixtyCheckbox = null;
let panelThirtyCheckbox = null;
let panelTimelineBody = null;
let panelPrepAffClock = null;
let panelPrepAffBtn = null;
let panelPrepNegClock = null;
let panelPrepNegBtn = null;
let panelCxClock = null;
let panelCxBtn = null;
let panelMuteCheckbox = null;

/** Boot the feature: commands, HUD, dock panel, toolbar button, bus wiring. */
export function init() {
    loadMuted();
    loadSignals();
    loadHudCollapsed();

    registerCommands();
    buildHud();
    registerPanelUI();
    registerToolbarButton();

    document.addEventListener("visibilitychange", handleVisibilityChange);

    bus.on("round:change", handleRoundChange);
    bus.on("round:change", () => renderPanel()); // catches undo/redo touching the timeline
    bus.on("file:opened", handleFileOpened);

    lastRoundId = store.round?.id ?? null;
    resetForRound(store.round);
}

// --- Round lifecycle ---------------------------------------------------------

function handleRoundChange() {
    const r = store.round;
    if (!r || r.id === lastRoundId) return;
    lastRoundId = r.id;
    resetForRound(r);
}

function handleFileOpened() {
    lastRoundId = store.round?.id ?? null;
    resetForRound(store.round);
}

/** Rebuild every clock from a (possibly null) round. Never throws on missing cascade. */
function resetForRound(round) {
    stopEngineHard();

    if (!round) {
        speechOrderList = [];
        preset = null;
        speech = freshSpeechState();
        prep = { aff: freshPrepState(0), neg: freshPrepState(0) };
        cx = freshCxState(0);
        renderAll();
        return;
    }

    const eventId = round.event ?? "policy";
    preset = findPreset(round.cascade?.prefs?.timerPreset);
    speech = freshSpeechState();
    speech.eventId = preset?.eventId ?? eventId;
    // speechOrder() reads .aff/.neg off the resolved EventDef, not an id string.
    speechOrderList = speechOrder(getEvent(speech.eventId), round.firstSide ?? "aff");
    armSpeech(speechOrderList.length ? 0 : -1);

    // Resume banked prep exactly where it was left; only fall back to a full
    // bank for a side that has never been touched (key absent, not just 0).
    const cascadePrep = round.cascade?.prep ?? {};
    const affSeconds = Number.isFinite(cascadePrep.aff) ? cascadePrep.aff : effectivePrepSeconds();
    const negSeconds = Number.isFinite(cascadePrep.neg) ? cascadePrep.neg : effectivePrepSeconds();
    prep = { aff: freshPrepState(affSeconds), neg: freshPrepState(negSeconds) };

    cx = freshCxState(effectiveCxSeconds());

    renderAll();
}

function freshSpeechState() {
    return {
        eventId: "policy",
        index: -1,
        speechId: null,
        side: null,
        limitSeconds: 0,
        accumMs: 0,
        running: false,
        runStartPerf: null,
        startedAtWall: null,
        alerted60: false,
        alerted30: false,
        alertedOver: false,
    };
}

function freshPrepState(seconds) {
    return {
        remainingMs: Math.max(0, seconds) * 1000,
        running: false,
        runStartPerf: null,
        alertedZero: false,
    };
}

function freshCxState(limitSeconds) {
    return {
        limitSeconds,
        accumMs: 0,
        running: false,
        runStartPerf: null,
        alerted30: false,
        alertedDone: false,
    };
}

// --- Effective timing (event defaults, overridden by the active preset) -----

function effectiveSpeechSeconds(speechId) {
    return preset?.speeches?.[speechId] ?? speechSeconds(speech.eventId, speechId);
}
function effectivePrepSeconds() {
    return preset?.prep ?? PREP_SECONDS[speech.eventId] ?? 0;
}
function effectiveCxSeconds() {
    return preset?.cx ?? CX_SECONDS[speech.eventId] ?? 0;
}
function allPresets() {
    if (!TIMER_PRESETS) return [];
    return Array.isArray(TIMER_PRESETS) ? TIMER_PRESETS : Object.values(TIMER_PRESETS);
}
function findPreset(id) {
    if (!id) return null;
    return allPresets().find((p) => p.id === id) ?? null;
}

// --- Speech clock -------------------------------------------------------------

function currentSpeechElapsedMs() {
    if (!speech.speechId) return 0;
    return speech.accumMs + (speech.running ? performance.now() - speech.runStartPerf : 0);
}

/** Load speech `idx` from `speechOrderList` (or unarm with -1). Does not touch the timeline. */
function armSpeech(idx) {
    const def = idx >= 0 ? speechOrderList[idx] : null;
    speech.index = idx;
    speech.speechId = def?.id ?? null;
    speech.side = def?.side ?? null;
    speech.limitSeconds = def ? effectiveSpeechSeconds(def.id) : 0;
    speech.accumMs = 0;
    speech.running = false;
    speech.runStartPerf = null;
    speech.startedAtWall = null;
    speech.alerted60 = false;
    speech.alerted30 = false;
    speech.alertedOver = false;
    emitSpeechEvent();
    // Every caller (next/prev/reset/initial arm) lands here with the speech
    // clock stopped; if nothing else (prep, cx) is running, the engine must
    // stop too, or a reset mid-speech leaves the rAF loop spinning forever.
    stopEngineIfIdle();
}

function toggleSpeechRunning() {
    if (!speech.speechId) return;
    if (speech.running) pauseSpeech();
    else startSpeech();
}

function startSpeech() {
    if (!speech.speechId || speech.running) return;
    if (!speech.startedAtWall) speech.startedAtWall = Date.now();
    speech.runStartPerf = performance.now();
    speech.running = true;
    // "Prep auto-stops when a speech starts" — freeze and persist both sides.
    stopPrep("aff");
    stopPrep("neg");
    startEngine();
    emitSpeechEvent();
    renderAll();
}

function pauseSpeech() {
    if (!speech.running) return;
    speech.accumMs = currentSpeechElapsedMs();
    speech.running = false;
    speech.runStartPerf = null;
    emitSpeechEvent();
    stopEngineIfIdle();
    renderAll();
}

/** End the armed speech (logging it to the timeline), arm the next one, and follow it in the grid. */
function endSpeechAndAdvance() {
    if (speech.speechId) {
        const elapsedMs = currentSpeechElapsedMs();
        const overByMs = Math.max(0, elapsedMs - speech.limitSeconds * 1000);
        const endedAt = Date.now();
        const startedAt = speech.startedAtWall ?? endedAt - Math.round(elapsedMs);
        const entry = {
            speechId: speech.speechId,
            startedAt,
            endedAt,
            seconds: Math.round(elapsedMs / 1000),
            overBy: Math.round(overByMs / 1000),
        };
        if (speech.running) {
            speech.accumMs = elapsedMs;
            speech.running = false;
            speech.runStartPerf = null;
        }
        if (store.round) {
            store.commit(
                (round) => {
                    const c = ensureCascade(round);
                    c.timeline.push(entry);
                },
                { label: `End ${speech.speechId}` },
            );
        }
    }
    const nextIdx = speech.index + 1 < speechOrderList.length ? speech.index + 1 : -1;
    armSpeech(nextIdx);
    gotoGridColumn();
    stopEngineIfIdle();
    renderAll();
}

function prevSpeech() {
    if (speech.running) pauseSpeech();
    const target = speech.index === -1 ? speechOrderList.length - 1 : speech.index - 1;
    if (target < 0) return;
    armSpeech(target);
    gotoGridColumn();
    renderAll();
}

/** Re-arm the current speech (or the first one) from zero. Does not log to the timeline. */
function resetSpeechClock() {
    const idx = speech.index >= 0 ? speech.index : speechOrderList.length ? 0 : -1;
    armSpeech(idx);
    renderAll();
}

function emitSpeechEvent() {
    bus.emit("timer:speech", {
        speechId: speech.speechId,
        side: speech.side,
        running: speech.running,
        remaining: speech.speechId ? speech.limitSeconds - currentSpeechElapsedMs() / 1000 : 0,
    });
}

/** Move the active sheet's live column to the armed speech, when that sheet shows it. */
function gotoGridColumn() {
    const sheet = store.activeSheet;
    const round = store.round;
    if (!sheet || !round || !speech.speechId) return;
    const cols = sheetColumns(round, sheet);
    const idx = cols.findIndex((c) => c.id === speech.speechId);
    if (idx < 0) return;
    const row = store.selection?.row ?? 0;
    bus.emit("grid:goto", { sheetId: sheet.id, row, col: idx });
}

// --- Prep clocks ---------------------------------------------------------------

function currentPrepRemainingMs(side) {
    const p = prep[side];
    if (!p.running) return Math.max(0, p.remainingMs);
    return Math.max(0, p.remainingMs - (performance.now() - p.runStartPerf));
}

function togglePrep(side) {
    if (prep[side].running) stopPrep(side);
    else startPrep(side);
    renderAll();
}

function startPrep(side) {
    const p = prep[side];
    if (p.running || currentPrepRemainingMs(side) <= 0) return;
    const other = side === "aff" ? "neg" : "aff"; // running one pauses the other
    if (prep[other].running) stopPrep(other);
    p.runStartPerf = performance.now();
    p.running = true;
    p.alertedZero = false;
    lastPrepPersist = performance.now();
    startEngine();
}

function stopPrep(side) {
    const p = prep[side];
    if (!p.running) return;
    p.remainingMs = currentPrepRemainingMs(side);
    p.running = false;
    p.runStartPerf = null;
    persistPrepNow();
    stopEngineIfIdle();
}

/** Commit both sides' remaining prep to `round.cascade.prep`, coalesced so it isn't 200 undo entries. */
function persistPrepNow() {
    if (!store.round) return;
    const affSec = Math.round(currentPrepRemainingMs("aff") / 1000);
    const negSec = Math.round(currentPrepRemainingMs("neg") / 1000);
    store.commit(
        (round) => {
            const c = ensureCascade(round);
            c.prep.aff = affSec;
            c.prep.neg = negSec;
        },
        { label: "Prep time", coalesce: "timer-prep" },
    );
}

// --- Cross-ex clock --------------------------------------------------------------

function currentCxElapsedMs() {
    return cx.accumMs + (cx.running ? performance.now() - cx.runStartPerf : 0);
}

function toggleCx() {
    if (cx.running) {
        cx.accumMs = currentCxElapsedMs();
        cx.running = false;
        cx.runStartPerf = null;
        stopEngineIfIdle();
    } else {
        cx.runStartPerf = performance.now();
        cx.running = true;
        cx.alerted30 = false;
        cx.alertedDone = false;
        startEngine();
    }
    renderAll();
}

function resetCx() {
    cx.accumMs = 0;
    cx.running = false;
    cx.runStartPerf = null;
    cx.alerted30 = false;
    cx.alertedDone = false;
    stopEngineIfIdle(); // was possibly the only thing keeping the loop alive
    renderAll();
}

// --- Mute ----------------------------------------------------------------------

function toggleMute() {
    muted = !muted;
    try {
        localStorage.setItem("cascade.timer.muted", muted ? "1" : "0");
    } catch {
        /* private browsing, etc. — mute just won't survive reload */
    }
    renderAll();
}

function loadMuted() {
    try {
        muted = localStorage.getItem("cascade.timer.muted") === "1";
    } catch {
        muted = false;
    }
}

function loadSignals() {
    signals = loadJSON("cascade.timer.signals", { sixty: false, thirty: true });
}

// --- Engine: performance.now()-anchored loop, rAF with a hidden-tab fallback ---

function isAnythingRunning() {
    return speech.running || prep.aff.running || prep.neg.running || cx.running;
}

function startEngine() {
    if (engineActive) return;
    engineActive = true;
    if (document.hidden) switchToInterval();
    else switchToRaf();
}

function stopEngineIfIdle() {
    if (isAnythingRunning()) return;
    stopEngineHard();
}

function stopEngineHard() {
    engineActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (intervalId) clearInterval(intervalId);
    rafId = null;
    intervalId = null;
}

function switchToRaf() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    if (rafId) return;
    const step = () => {
        if (!engineActive) {
            rafId = null;
            return;
        }
        tick();
        // tick() can itself stop everything (e.g. an alert firing exhausts
        // the last running clock) — re-check before scheduling another frame.
        if (!engineActive) {
            rafId = null;
            return;
        }
        if (document.hidden) {
            rafId = null;
            switchToInterval();
            return;
        }
        rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
}

function switchToInterval() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (intervalId) return;
    intervalId = setInterval(() => {
        if (!engineActive) {
            clearInterval(intervalId);
            intervalId = null;
            return;
        }
        tick();
        if (!engineActive) {
            clearInterval(intervalId);
            intervalId = null;
            return;
        }
        if (!document.hidden) {
            clearInterval(intervalId);
            intervalId = null;
            switchToRaf();
        }
    }, 250);
}

function handleVisibilityChange() {
    if (!engineActive) return;
    if (document.hidden) switchToInterval();
    else switchToRaf();
}

/** One engine step: check alerts (edge-triggered, so each fires once), repaint, and emit. */
function tick() {
    checkSpeechAlerts();
    checkCxAlerts();
    checkPrepAlerts();

    const now = performance.now();
    if (now - lastRenderAt >= RENDER_MS) {
        lastRenderAt = now;
        renderAll();
    }
    if (now - lastTickEmit >= TICK_EMIT_MS) {
        lastTickEmit = now;
        bus.emit("timer:tick", {
            remaining: speech.speechId ? speech.limitSeconds - currentSpeechElapsedMs() / 1000 : 0,
            elapsed: currentSpeechElapsedMs() / 1000,
            speechId: speech.speechId,
            running: speech.running,
        });
    }
    // Periodic safety net: don't let a laptop dying mid-prep lose more than
    // ~15s of banked time, but don't commit every tick either — that would
    // keep the store "dirty" continuously and autosave (2s of *idle*) would
    // never fire.
    if ((prep.aff.running || prep.neg.running) && now - lastPrepPersist >= PREP_PERSIST_MS) {
        lastPrepPersist = now;
        persistPrepNow();
    }
}

// --- Alerts: Web Audio beeps + a visual flash -----------------------------------

let audioCtx = null;

function ensureAudioCtx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
}

/** Play `freqs.length` short sine tones back to back. Mute silences audio only — the flash still fires. */
function beep(freqs, durationMs) {
    if (muted) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    let t = ctx.currentTime;
    for (const freq of freqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + durationMs / 1000 + 0.02);
        t += (durationMs + 60) / 1000;
    }
    flashHud();
}

const alertWarning = () => beep([880, 988], 130); // two-tone: "time's getting short"
const alertDone = () => beep([440, 440, 440], 260); // longer, unmistakable: "stop talking"

function flashHud() {
    if (!hudRoot) return;
    hudRoot.style.boxShadow = "0 0 0 4px var(--neg, #f43f5e), 0 4px 16px rgba(0,0,0,0.4)";
    setTimeout(() => {
        if (hudRoot) hudRoot.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)";
    }, 350);
}

function checkSpeechAlerts() {
    if (!speech.running || !speech.speechId) return;
    const remainingMs = speech.limitSeconds * 1000 - currentSpeechElapsedMs();
    if (remainingMs <= 0) {
        if (!speech.alertedOver) {
            speech.alertedOver = true;
            alertDone();
        }
        return;
    }
    if (signals.sixty && remainingMs <= 60000 && !speech.alerted60) {
        speech.alerted60 = true;
        alertWarning();
    }
    if (signals.thirty && remainingMs <= 30000 && !speech.alerted30) {
        speech.alerted30 = true;
        alertWarning();
    }
}

function checkCxAlerts() {
    if (!cx.running) return;
    const remainingMs = cx.limitSeconds * 1000 - currentCxElapsedMs();
    if (remainingMs <= 0) {
        if (!cx.alertedDone) {
            cx.alertedDone = true;
            alertDone();
        }
    } else if (remainingMs <= 30000 && !cx.alerted30) {
        cx.alerted30 = true;
        alertWarning();
    }
}

function checkPrepAlerts() {
    for (const side of ["aff", "neg"]) {
        const p = prep[side];
        if (!p.running || p.alertedZero) continue;
        if (currentPrepRemainingMs(side) <= 0) {
            p.alertedZero = true;
            stopPrep(side); // freezes it at exactly 0 and persists
            alertDone();
        }
    }
}

// --- Commands ------------------------------------------------------------------

function registerCommands() {
    register({
        id: "timer.startStop",
        title: "Start/stop speech clock",
        category: "Timers",
        icon: "⏱",
        keys: ["Mod+Shift+Space"],
        run: toggleSpeechRunning,
    });
    register({
        id: "timer.next",
        title: "End speech & advance",
        category: "Timers",
        keys: ["Mod+Shift+ArrowRight"],
        run: endSpeechAndAdvance,
    });
    register({
        id: "timer.prev",
        title: "Previous speech",
        category: "Timers",
        run: prevSpeech,
    });
    register({
        id: "timer.reset",
        title: "Reset speech clock",
        category: "Timers",
        run: resetSpeechClock,
    });
    register({
        id: "timer.prepAff",
        title: "Start/stop AFF prep",
        category: "Timers",
        // Mod+Shift+A is sheets.js's; prep gets Mod+Alt+ instead.
        keys: ["Mod+Alt+A"],
        run: () => togglePrep("aff"),
    });
    register({
        id: "timer.prepNeg",
        title: "Start/stop NEG prep",
        category: "Timers",
        keys: ["Mod+Alt+N"],
        run: () => togglePrep("neg"),
    });
    register({
        id: "timer.mute",
        title: "Mute/unmute timer alerts",
        category: "Timers",
        run: toggleMute,
    });
    register({
        id: "timer.cx",
        title: "Start/stop cross-ex clock",
        category: "Timers",
        run: toggleCx,
    });
    register({
        id: "timer.openPanel",
        title: "Open round clock panel",
        category: "Timers",
        run: () => ui.showPanel(PANEL_ID),
    });
}

// --- HUD -------------------------------------------------------------------------

function buildHud() {
    const host = ui.hud();
    hudSpeechLabel = el("div.cascade-hud-speech", {
        style: { fontSize: "0.85rem", opacity: "0.8", letterSpacing: "0.02em" },
    });
    hudClock = el("div.cascade-hud-clock", {
        style: {
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            fontSize: "2.4rem",
            fontWeight: "700",
            lineHeight: "1.1",
            fontVariantNumeric: "tabular-nums",
        },
    });
    hudPrepAff = el("span.cascade-hud-prep-aff", { style: { fontFamily: "ui-monospace, monospace" } });
    hudPrepNeg = el("span.cascade-hud-prep-neg", { style: { fontFamily: "ui-monospace, monospace" } });
    hudPrepRow = el(
        "div.cascade-hud-prep",
        { style: { display: "flex", gap: "14px", fontSize: "0.85rem", marginTop: "4px" } },
        hudPrepAff,
        hudPrepNeg,
    );
    hudCollapseBtn = el(
        "button.cascade-hud-collapse",
        {
            type: "button",
            "aria-label": "Collapse timer",
            title: "Collapse/expand",
            onclick: toggleHudCollapsed,
            style: {
                position: "absolute",
                top: "4px",
                right: "6px",
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                font: "inherit",
                opacity: "0.7",
            },
        },
        "▾",
    );
    hudDragHandle = el(
        "div.cascade-hud-drag",
        {
            title: "Drag to move",
            style: {
                position: "absolute",
                top: "4px",
                left: "6px",
                cursor: "grab",
                opacity: "0.5",
                fontSize: "0.8rem",
                touchAction: "none",
            },
        },
        "⋮⋮",
    );
    hudRoot = el(
        "div.cascade-timer-hud",
        {
            role: "group",
            "aria-label": "Round clock",
            style: {
                position: "absolute",
                zIndex: "20",
                minWidth: "180px",
                padding: "10px 16px",
                borderRadius: "12px",
                border: "2px solid rgba(255,255,255,0.2)",
                background: "var(--d1-navy, #051C2C)",
                color: "var(--d1-accent-2, #e5f2ff)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                userSelect: "none",
                textAlign: "center",
                pointerEvents: "auto",
            },
        },
        hudDragHandle,
        hudCollapseBtn,
        hudSpeechLabel,
        hudClock,
        hudPrepRow,
    );
    host.append(hudRoot);
    makeDraggable(hudRoot, hudDragHandle);
    restoreHudPosition();
    applyHudCollapsed();
    renderHud();
}

function makeDraggable(root, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    handle.addEventListener("pointerdown", (e) => {
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        const rect = root.getBoundingClientRect();
        const hostRect = root.offsetParent
            ? root.offsetParent.getBoundingClientRect()
            : { left: 0, top: 0 };
        origLeft = rect.left - hostRect.left;
        origTop = rect.top - hostRect.top;
        startX = e.clientX;
        startY = e.clientY;
        root.style.right = "auto";
    });
    handle.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const left = Math.max(0, origLeft + (e.clientX - startX));
        const top = Math.max(0, origTop + (e.clientY - startY));
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
    });
    const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        try {
            handle.releasePointerCapture(e.pointerId);
        } catch {
            /* already released */
        }
        saveJSON("cascade.timer.hudPos", {
            left: parseFloat(root.style.left) || 0,
            top: parseFloat(root.style.top) || 0,
        });
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
}

function restoreHudPosition() {
    const pos = loadJSON("cascade.timer.hudPos", null);
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        hudRoot.style.left = `${pos.left}px`;
        hudRoot.style.top = `${pos.top}px`;
        hudRoot.style.right = "auto";
    } else {
        hudRoot.style.top = "12px";
        hudRoot.style.right = "12px";
    }
}

function loadHudCollapsed() {
    hudCollapsed = loadJSON("cascade.timer.hudCollapsed", false) === true;
}

function toggleHudCollapsed() {
    hudCollapsed = !hudCollapsed;
    saveJSON("cascade.timer.hudCollapsed", hudCollapsed);
    applyHudCollapsed();
}

function applyHudCollapsed() {
    if (!hudRoot) return;
    hudPrepRow.style.display = hudCollapsed ? "none" : "flex";
    hudSpeechLabel.style.display = hudCollapsed ? "none" : "block";
    hudClock.style.fontSize = hudCollapsed ? "1.15rem" : "2.4rem";
    hudCollapseBtn.textContent = hudCollapsed ? "▸" : "▾";
    hudRoot.style.padding = hudCollapsed ? "4px 22px 4px 10px" : "10px 16px";
    hudRoot.style.minWidth = hudCollapsed ? "0" : "180px";
}

function renderHud() {
    if (!hudRoot) return;
    const def = speech.index >= 0 ? speechOrderList[speech.index] : null;
    hudSpeechLabel.textContent = def ? `${def.short} · ${def.name}` : "No speech armed";

    const elapsedSec = currentSpeechElapsedMs() / 1000;
    const remainingSec = speech.speechId ? speech.limitSeconds - elapsedSec : 0;
    const over = remainingSec < 0;
    hudClock.textContent = speech.speechId
        ? over
            ? `+${fmtClock(Math.abs(remainingSec))}`
            : fmtClock(remainingSec)
        : "—:—";
    hudClock.style.color = over
        ? "var(--neg, #f43f5e)"
        : remainingSec <= 30 && remainingSec > 0
          ? "var(--card, #fbbf24)"
          : "var(--d1-accent-2, #e5f2ff)";
    hudRoot.style.borderColor =
        speech.side === "aff"
            ? "var(--aff, #10b981)"
            : speech.side === "neg"
              ? "var(--neg, #f43f5e)"
              : "rgba(255,255,255,0.2)";

    const affMs = currentPrepRemainingMs("aff");
    const negMs = currentPrepRemainingMs("neg");
    hudPrepAff.textContent = `AFF ${fmtClock(affMs / 1000)}`;
    hudPrepAff.style.color =
        affMs <= 0 ? "var(--neg, #f43f5e)" : prep.aff.running ? "var(--d1-accent-2, #38bdf8)" : "inherit";
    hudPrepNeg.textContent = `NEG ${fmtClock(negMs / 1000)}`;
    hudPrepNeg.style.color =
        negMs <= 0 ? "var(--neg, #f43f5e)" : prep.neg.running ? "var(--d1-accent-2, #38bdf8)" : "inherit";
}

// --- Dock panel --------------------------------------------------------------------

function registerPanelUI() {
    ui.registerPanel({
        id: PANEL_ID,
        title: "Timers",
        icon: "⏱",
        order: 10,
        mount: buildPanel,
        onShow: () => {
            panelVisible = true;
            renderPanel();
        },
        onHide: () => {
            panelVisible = false;
        },
    });
}

function buildPanel(host) {
    clear(host);

    // -- current speech controls --
    panelSpeechLabel = el("div.cascade-panel-speech", { style: { fontWeight: "600" } });
    panelClock = el("div.cascade-panel-clock", {
        style: {
            fontFamily: "ui-monospace, monospace",
            fontSize: "2rem",
            fontVariantNumeric: "tabular-nums",
        },
    });
    panelStartStopBtn = el("button", { type: "button", onclick: toggleSpeechRunning }, "Start");
    const prevBtn = el("button", { type: "button", onclick: prevSpeech }, "◀ Prev");
    const nextBtn = el("button", { type: "button", onclick: endSpeechAndAdvance }, "End & Next ▶");
    const resetBtn = el("button", { type: "button", onclick: resetSpeechClock }, "Reset");

    const eventPickerRow = el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } });
    panelPresetSelect = el("select", {
        onchange: (e) => setPreset(e.target.value || null),
    });
    eventPickerRow.append(el("label", null, "Preset"), panelPresetSelect);

    const signalsRow = el("div", { style: { display: "flex", gap: "14px", fontSize: "0.85rem" } });
    panelSixtyCheckbox = el("input", {
        type: "checkbox",
        id: "cascade-signal-60",
        onchange: (e) => {
            signals.sixty = e.target.checked;
            saveJSON("cascade.timer.signals", signals);
        },
    });
    panelThirtyCheckbox = el("input", {
        type: "checkbox",
        id: "cascade-signal-30",
        onchange: (e) => {
            signals.thirty = e.target.checked;
            saveJSON("cascade.timer.signals", signals);
        },
    });
    signalsRow.append(
        el("label", { for: "cascade-signal-60" }, panelSixtyCheckbox, " 1 min warning"),
        el("label", { for: "cascade-signal-30" }, panelThirtyCheckbox, " 30s warning"),
    );

    const speechSection = el(
        "section.cascade-panel-section",
        null,
        panelSpeechLabel,
        panelClock,
        el(
            "div",
            { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            panelStartStopBtn,
            prevBtn,
            nextBtn,
            resetBtn,
        ),
        eventPickerRow,
        signalsRow,
    );

    // -- timeline table --
    panelTimelineBody = el("tbody");
    const timelineTable = el(
        "table.cascade-timeline",
        { role: "grid", style: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" } },
        el(
            "thead",
            null,
            el(
                "tr",
                null,
                el("th", null, "Speech"),
                el("th", null, "Side"),
                el("th", null, "Limit"),
                el("th", null, "Actual"),
                el("th", null, "Δ"),
            ),
        ),
        panelTimelineBody,
    );
    const timelineSection = el(
        "section.cascade-panel-section",
        null,
        el("h4", null, "Round timeline"),
        timelineTable,
    );

    // -- prep --
    panelPrepAffClock = el("span", { style: { fontFamily: "ui-monospace, monospace" } });
    panelPrepAffBtn = el("button", { type: "button", onclick: () => togglePrep("aff") }, "Start");
    panelPrepNegClock = el("span", { style: { fontFamily: "ui-monospace, monospace" } });
    panelPrepNegBtn = el("button", { type: "button", onclick: () => togglePrep("neg") }, "Start");
    const prepSection = el(
        "section.cascade-panel-section",
        null,
        el("h4", null, "Prep time"),
        el(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            el("span", null, "AFF"),
            panelPrepAffClock,
            panelPrepAffBtn,
        ),
        el(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            el("span", null, "NEG"),
            panelPrepNegClock,
            panelPrepNegBtn,
        ),
    );

    // -- cross-ex --
    panelCxClock = el("span", { style: { fontFamily: "ui-monospace, monospace" } });
    panelCxBtn = el("button", { type: "button", onclick: toggleCx }, "Start");
    const cxResetBtn = el("button", { type: "button", onclick: resetCx }, "Reset");
    const cxSection = el(
        "section.cascade-panel-section",
        null,
        el("h4", null, "Cross-ex"),
        el(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } },
            panelCxClock,
            panelCxBtn,
            cxResetBtn,
        ),
    );

    // -- mute --
    panelMuteCheckbox = el("input", {
        type: "checkbox",
        id: "cascade-timer-mute",
        onchange: () => toggleMute(),
    });
    const muteSection = el(
        "section.cascade-panel-section",
        null,
        el("label", { for: "cascade-timer-mute" }, panelMuteCheckbox, " Mute alerts"),
    );

    host.append(speechSection, timelineSection, prepSection, cxSection, muteSection);
    renderPanel();
}

function renderPanel() {
    if (!panelSpeechLabel) return; // not mounted yet

    const def = speech.index >= 0 ? speechOrderList[speech.index] : null;
    panelSpeechLabel.textContent = def
        ? `${def.short} — ${def.name} (${sideLabelFor(def.side)})`
        : "No speech armed";
    const elapsedSec = currentSpeechElapsedMs() / 1000;
    const remainingSec = speech.speechId ? speech.limitSeconds - elapsedSec : 0;
    const over = remainingSec < 0;
    panelClock.textContent = speech.speechId
        ? over
            ? `+${fmtClock(Math.abs(remainingSec))}`
            : fmtClock(remainingSec)
        : "—:—";
    panelClock.style.color = over ? "var(--neg, #f43f5e)" : "inherit";
    panelStartStopBtn.textContent = speech.running ? "Pause" : "Start";
    panelStartStopBtn.disabled = !speech.speechId;

    renderPresetSelect();
    panelSixtyCheckbox.checked = signals.sixty;
    panelThirtyCheckbox.checked = signals.thirty;

    renderTimelineTable();

    const affMs = currentPrepRemainingMs("aff");
    const negMs = currentPrepRemainingMs("neg");
    panelPrepAffClock.textContent = fmtClock(affMs / 1000);
    panelPrepAffClock.style.color = affMs <= 0 ? "var(--neg, #f43f5e)" : "inherit";
    panelPrepAffBtn.textContent = prep.aff.running ? "Pause" : "Start";
    panelPrepAffBtn.disabled = !prep.aff.running && affMs <= 0;
    panelPrepNegClock.textContent = fmtClock(negMs / 1000);
    panelPrepNegClock.style.color = negMs <= 0 ? "var(--neg, #f43f5e)" : "inherit";
    panelPrepNegBtn.textContent = prep.neg.running ? "Pause" : "Start";
    panelPrepNegBtn.disabled = !prep.neg.running && negMs <= 0;

    const cxRemaining = cx.limitSeconds - currentCxElapsedMs() / 1000;
    panelCxClock.textContent = cxRemaining < 0 ? `+${fmtClock(Math.abs(cxRemaining))}` : fmtClock(cxRemaining);
    panelCxClock.style.color = cxRemaining < 0 ? "var(--neg, #f43f5e)" : "inherit";
    panelCxBtn.textContent = cx.running ? "Pause" : "Start";

    panelMuteCheckbox.checked = muted;
}

function renderPresetSelect() {
    if (!panelPresetSelect) return;
    const wanted = preset?.id ?? "";
    if (panelPresetSelect.dataset.built !== speech.eventId + "|" + allPresets().length) {
        clear(panelPresetSelect);
        panelPresetSelect.append(el("option", { value: "" }, `${getEvent(store.round?.event ?? "policy").name} (default)`));
        for (const p of allPresets()) {
            panelPresetSelect.append(el("option", { value: p.id }, p.label));
        }
        panelPresetSelect.dataset.built = speech.eventId + "|" + allPresets().length;
    }
    panelPresetSelect.value = wanted;
}

function renderTimelineTable() {
    if (!panelTimelineBody) return;
    clear(panelTimelineBody);
    const entries = store.cascade?.timeline ?? [];
    speechOrderList.forEach((def, idx) => {
        let entry = null;
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].speechId === def.id) {
                entry = entries[i];
                break;
            }
        }
        const limitSeconds = effectiveSpeechSeconds(def.id);
        const delta = entry ? entry.seconds - limitSeconds : null;
        const row = el(
            "tr",
            idx === speech.index ? { style: { fontWeight: "700" } } : null,
            el("td", null, def.short),
            el("td", null, sideLabelFor(def.side)),
            el("td", null, fmtClock(limitSeconds)),
            el("td", null, entry ? fmtClock(entry.seconds) : "—"),
            el(
                "td",
                { style: { color: delta > 0 ? "var(--neg, #f43f5e)" : "inherit" } },
                entry ? fmtDelta(delta) : "—",
            ),
        );
        panelTimelineBody.append(row);
    });
}

function sideLabelFor(side) {
    if (!side) return "";
    const labels = sideLabels(speech.eventId);
    return labels?.[side]?.label ?? side;
}

function fmtDelta(deltaSeconds) {
    if (!deltaSeconds) return "on time";
    const sign = deltaSeconds > 0 ? "+" : "−";
    return `${sign}${fmtClock(Math.abs(deltaSeconds))}`;
}

function setPreset(id) {
    preset = findPreset(id);
    const eventId = store.round?.event ?? "policy";
    speech.eventId = preset?.eventId ?? eventId;
    speechOrderList = speechOrder(getEvent(speech.eventId), store.round?.firstSide ?? "aff");
    armSpeech(speechOrderList.length ? 0 : -1);
    cx.limitSeconds = effectiveCxSeconds();
    if (store.round) {
        store.commit(
            (round) => {
                const c = ensureCascade(round);
                c.prefs = c.prefs || {};
                if (id) c.prefs.timerPreset = id;
                else delete c.prefs.timerPreset;
            },
            { label: "Timer preset" },
        );
    }
    renderAll();
}

// --- Toolbar ---------------------------------------------------------------------

function registerToolbarButton() {
    ui.addToolbarButton({
        id: TOOLBAR_ID,
        label: "—:—",
        icon: "⏱",
        title: "Round clock — click to open",
        slot: "center",
        onClick: () => ui.togglePanel(PANEL_ID),
    });
}

function renderToolbar() {
    const elapsedSec = currentSpeechElapsedMs() / 1000;
    const remainingSec = speech.speechId ? speech.limitSeconds - elapsedSec : null;
    const label =
        remainingSec === null
            ? "—:—"
            : remainingSec < 0
              ? `+${fmtClock(Math.abs(remainingSec))}`
              : fmtClock(remainingSec);
    ui.setToolbarButtonState(TOOLBAR_ID, { label, active: speech.running });
}

// --- Shared render / persistence helpers ----------------------------------------

function renderAll() {
    renderHud();
    renderToolbar();
    if (panelVisible) renderPanel();
}

function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* private browsing, quota, etc. — position/collapse just won't persist */
    }
}

/**
 * Snapshot for other panels (insights.js) to read without their own loop.
 * @returns {{speechId:string|null, running:boolean, remaining:number, elapsed:number,
 *   prep:{aff:number, neg:number}}} seconds throughout; `remaining` goes negative when over.
 */
function state() {
    const elapsed = currentSpeechElapsedMs() / 1000;
    return {
        speechId: speech.speechId,
        running: speech.running,
        remaining: speech.speechId ? speech.limitSeconds - elapsed : 0,
        elapsed,
        prep: {
            aff: currentPrepRemainingMs("aff") / 1000,
            neg: currentPrepRemainingMs("neg") / 1000,
        },
    };
}

export const timers = { init, state };
export default timers;
