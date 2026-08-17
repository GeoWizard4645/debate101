/**
 * Cascade — FEATURE 3: Voice Flow, assisted speech capture.
 *
 * A debater cannot type as fast as a debate is spoken, but they *can* say the
 * tag while their hands are still finishing the line above it. This module
 * listens with the browser's own speech engine, shows what it heard as it
 * hears it, and — depending on the capture mode the debater picked — drops
 * finished phrases into the grid as new rows so the flow keeps pace with the
 * round instead of trailing it.
 *
 * It is entirely optional scaffolding on top of a working app: on a browser
 * without the Web Speech API this module still boots, still shows a panel
 * (explaining why voice is unavailable here), and registers commands that no
 * -op with a clear toast instead of throwing. Nothing about the rest of
 * Cascade depends on this file doing anything at all.
 */

import { bus } from "./bus.js";
import { el, clear, download, debounce, MOD_LABEL } from "./dom.js";
import { registerAll } from "./registry.js";
import { store } from "./store.js";
import { ui } from "./ui.js";

const PANEL_ID = "voice";
const SETTINGS_KEY = "cascade.voice.settings";

// Defaults per the spec: words/phrases a debater actually says mid-speech
// that mean "new argument, new row" even without a pause. "cross-apply" and
// "cross apply" are both listed because speech recognizers are inconsistent
// about the hyphen.
const DEFAULT_TRIGGERS = [
    "first", "second", "third", "next off", "turn", "extend",
    "cross-apply", "cross apply", "impact", "moving to", "off the", "on the",
];

// Feature detection happens once, at module load, before anything else in
// this file touches the recognizer. Every other function checks `supported`
// rather than re-probing `window`, so a browser that lies about the ctor but
// throws on construction still fails safely inside start().
const SpeechRecognitionCtor =
    (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
const supported = Boolean(SpeechRecognitionCtor);

// --- Module state --------------------------------------------------------------
// A plain closure, not a class: this file has exactly one instance for the
// lifetime of the tab, so instance state is just module state.

/** @type {{mode: "off"|"assist"|"full", triggers: string[], lang: string}} */
let settings = null;

let recognition = null;           // the live SpeechRecognition instance, or null between sessions
let listening = false;            // "the user wants this running" — survives brief reconnect gaps
let explicitStop = false;         // set by stop(); tells onend not to restart
let fatalError = false;           // set on not-allowed / service-not-allowed / audio-capture
let restartAttempts = 0;
let restartTimer = null;
let sessionStartedAt = 0;

// getUserMedia + AnalyserNode for the level meter. Kept fully separate from
// the recognizer's own (invisible, browser-managed) mic use, per spec: we
// request our own stream so we can draw a meter, and we own its lifecycle.
let meterStream = null;
let audioCtx = null;
let analyser = null;
let meterRaf = null;

let currentSpeechId = null;       // last speechId seen on the `timer:speech` bus topic

// DOM refs, populated by the builders below and reused across re-renders.
let stripEl = null, stripDotEl = null, stripTextEl = null, stripMeterFillEl = null;
let stripHost = null;             // where the strip actually lives: hud() or the panel
let panelBodyEl = null, statusEl = null, modeRowEl = null, transcriptListEl = null, searchInputEl = null;
let startStopBtnEl = null;
let pulseAnim = null;

// --- Settings (localStorage; per-machine, not per-round) ------------------------
// Capture mode and the trigger list are debater habits, not round data — they
// should follow the person across files the way a keymap does, so they live
// in localStorage next to `cascade.keymap` and `cascade.blocks`, not in
// `round.cascade`.

function defaultLang() {
    return (typeof navigator !== "undefined" && navigator.language) || "en-US";
}

/** Load settings from localStorage, filling in defaults for anything missing or corrupt. */
function loadSettings() {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    } catch {
        saved = null; // corrupt JSON — fall through to defaults rather than crash boot
    }
    settings = {
        mode: saved?.mode === "off" || saved?.mode === "full" ? saved.mode : "assist",
        triggers:
            Array.isArray(saved?.triggers) && saved.triggers.length
                ? saved.triggers.filter((t) => typeof t === "string")
                : [...DEFAULT_TRIGGERS],
        lang: typeof saved?.lang === "string" && saved.lang ? saved.lang : defaultLang(),
    };
    return settings;
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Storage full or disabled (private browsing): settings just won't
        // persist across reloads. Not worth bothering the debater about.
    }
}

// --- Trigger matching & sentence segmentation -----------------------------------

/** Strip leading punctuation/whitespace and lowercase, for trigger comparison. */
function normalizeStart(text) {
    return text.trim().toLowerCase().replace(/^[^a-z0-9]+/, "");
}

/** True when `text` starts with one of the configured trigger phrases. */
function startsWithTrigger(text, triggers) {
    const norm = normalizeStart(text);
    if (!norm) return false;
    return triggers.some((raw) => {
        const trig = raw.trim().toLowerCase();
        if (!trig) return false;
        return norm === trig || norm.startsWith(trig + " ") || norm.startsWith(trig + ",");
    });
}

/** Build a case-insensitive whole-word/phrase regex matching any trigger, longest first. */
function buildTriggerRegex(triggers) {
    const escaped = triggers
        .map((t) => t.trim())
        .filter(Boolean)
        // Longest phrase first so "cross apply" wins over a hypothetical
        // shorter overlapping trigger instead of being shadowed by it.
        .sort((a, b) => b.length - a.length)
        .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    if (!escaped.length) return null;
    return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gi");
}

/**
 * Split one rough sentence at every trigger phrase that starts *inside* it
 * (not at position 0, which is already the start of a phrase). This is what
 * lets a run-on utterance like "...so that's the link turn cross apply my
 * case" become two flowable rows instead of one paragraph.
 */
function splitOnTriggers(sentence, triggers) {
    const re = buildTriggerRegex(triggers);
    if (!re) return [sentence];
    const cuts = [0];
    let m;
    while ((m = re.exec(sentence))) {
        if (m.index > 0) cuts.push(m.index);
        if (m.index === re.lastIndex) re.lastIndex += 1; // guard against zero-length matches
    }
    if (cuts.length === 1) return [sentence];
    cuts.push(sentence.length);
    const parts = [];
    for (let i = 0; i < cuts.length - 1; i += 1) {
        const piece = sentence.slice(cuts[i], cuts[i + 1]).trim();
        if (piece) parts.push(piece);
    }
    return parts;
}

/** Rough sentence split on . ! ? — good enough for spoken debate cadence. */
function splitSentences(text) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const parts = trimmed.match(/[^.!?]+[.!?]*(?:\s+|$)/g) ?? [trimmed];
    return parts.map((p) => p.trim()).filter(Boolean);
}

/** A final transcript chunk -> the ordered list of flowable phrases inside it. */
function segmentFinalTranscript(text, triggers) {
    const phrases = [];
    for (const sentence of splitSentences(text)) {
        phrases.push(...splitOnTriggers(sentence, triggers));
    }
    return phrases;
}

// --- Transcript persistence ------------------------------------------------------

/**
 * Append one phrase to `round.cascade.transcript`, coalesced so a whole
 * speech of voice capture is one undo step, not one per phrase. Defensive
 * about `cascade.transcript` not existing yet: model.js owns adding that key
 * to `ensureCascade`, but this module must not assume it landed first.
 */
function logTranscript(text) {
    const entry = { speechId: currentSpeechId, at: Date.now(), text };
    store.commit(
        (round) => {
            const cascade = round.cascade || (round.cascade = {});
            if (!Array.isArray(cascade.transcript)) cascade.transcript = [];
            cascade.transcript.push({ ...entry });
        },
        { coalesce: "voice", silent: true, label: "Voice transcript" },
    );
    renderTranscript();
}

/** One final transcript chunk from the recognizer: segment, log, maybe flow it in. */
function handleFinalTranscript(rawText) {
    const text = rawText.trim();
    if (!text) return;
    const phrases = segmentFinalTranscript(text, settings.triggers);
    for (const phrase of phrases) {
        logTranscript(phrase);
        const triggered = startsWithTrigger(phrase, settings.triggers);
        const shouldInsert =
            settings.mode === "full" || (settings.mode === "assist" && triggered);
        if (shouldInsert) {
            // newRow: true matches grid.insertText(text, {newRow}) and the
            // FEATURE 3 spec exactly — one detected phrase, one new row, so
            // the tag lands while the debater is still saying the warrant.
            bus.emit("grid:insertText", { text: phrase, newRow: true });
        }
    }
}

function onTimerSpeech(payload) {
    if (payload && typeof payload === "object" && payload.speechId) {
        currentSpeechId = payload.speechId;
    }
}

// --- Speech recognition lifecycle -------------------------------------------------

/** Start one recognition session. Called on user start and on every auto-restart. */
function startRecognitionSession() {
    if (!supported) return;
    const rec = new SpeechRecognitionCtor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = settings.lang || defaultLang();
    rec.maxAlternatives = 1;

    // Every handler below checks `recognition === rec` before touching shared
    // state. A stop()-then-start() in quick succession leaves the *old*
    // instance's events still in flight (onend arrives asynchronously); without
    // this guard its late onend would null out the module-level `recognition`
    // reference *after* it already points at the new, actually-live session —
    // so a later stop() would silently do nothing and the mic would keep
    // running. Ignoring events from a superseded instance closes that gap.
    rec.onstart = () => {
        if (recognition !== rec) return;
        sessionStartedAt = Date.now();
        setStatus("Listening...", "active");
        setSessionActive(true);
    };
    rec.onresult = (event) => {
        if (recognition !== rec) return;
        onRecognitionResult(event);
    };
    rec.onerror = (event) => {
        if (recognition !== rec) return;
        onRecognitionError(event);
    };
    rec.onend = () => {
        if (recognition !== rec) return; // stale session ending after being superseded — nothing to do
        recognition = null;
        onRecognitionEnd();
    };

    recognition = rec;
    try {
        rec.start();
    } catch (err) {
        // InvalidStateError etc: start() failed synchronously so onend will
        // never fire for this attempt. Drive the same backoff loop by hand
        // so a transient failure (e.g. mic momentarily held by another tab)
        // still recovers instead of going silent forever.
        console.error("[voice] recognition.start() threw:", err);
        setStatus(`Couldn't start speech recognition: ${err.message}`, "error");
        if (recognition === rec) recognition = null;
        scheduleRestart(false);
    }
}

function onRecognitionResult(event) {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
            handleFinalTranscript(transcript);
        } else {
            interim += transcript;
        }
    }
    setStripInterim(interim);
}

function onRecognitionError(event) {
    const code = event.error;
    if (code === "not-allowed" || code === "service-not-allowed") {
        // Permanent until the debater changes a browser permission — retrying
        // just spams the same denial, so stop and say exactly what to do.
        fatalError = true;
        listening = false;
        setStatus(
            "Microphone access was denied. Allow the microphone for this site in your browser settings, then press Start again.",
            "error",
        );
        stopMeter();
        updateToolbar();
    } else if (code === "audio-capture") {
        fatalError = true;
        listening = false;
        setStatus("No microphone was found. Check that one is connected, then press Start again.", "error");
        stopMeter();
        updateToolbar();
    } else if (code === "no-speech") {
        // Not an error a debater needs to act on — just silence. onend fires
        // right after this and the normal restart loop picks it back up.
        setStatus("Listening — no speech detected yet.", "info");
    } else if (code === "aborted") {
        // We caused this ourselves (explicit stop, or a restart calling
        // stop() on the previous instance). Nothing to report.
    } else {
        setStatus(`Speech recognition error: ${code}`, "warn");
    }
}

function onRecognitionEnd() {
    // Caller (rec.onend, above) has already confirmed this was still the live
    // session and cleared `recognition` before invoking us.
    setSessionActive(false);
    if (!listening || explicitStop || fatalError) return;
    // Chrome ends a session after a stretch of silence even while the
    // debater is still speaking-with-pauses; that is normal and should
    // reconnect almost instantly. A session that dies within a few seconds
    // of starting is more likely a real problem, so back off exponentially
    // instead of hammering the mic.
    const healthy = sessionStartedAt && Date.now() - sessionStartedAt > 3000;
    scheduleRestart(healthy);
}

function scheduleRestart(healthy) {
    if (healthy) {
        restartAttempts = 0;
    } else {
        restartAttempts += 1;
    }
    const delay = healthy ? 250 : Math.min(500 * 2 ** (restartAttempts - 1), 10000);
    setStatus("Reconnecting...", "info");
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        if (listening && !explicitStop && !fatalError) startRecognitionSession();
    }, delay);
}

/** Begin listening. Mic permission is requested here, never before — only on user action. */
async function start() {
    if (!supported || listening) return;
    explicitStop = false;
    fatalError = false;
    restartAttempts = 0;
    listening = true;
    setStatus("Starting...", "info");
    setStripVisible(true);
    updateToolbar();
    startRecognitionSession();
    try {
        await startMeter();
    } catch (err) {
        // The level meter is a nicety; recognition itself does not depend on
        // this stream, so a failure here degrades the UI, not the feature.
        setStatus(`Level meter unavailable: ${err.message}`, "warn");
    }
}

/** Stop listening. Releases the meter's mic track and blocks any pending auto-restart. */
function stop() {
    explicitStop = true;
    listening = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    if (recognition) {
        try {
            recognition.stop();
        } catch {
            // Already stopped/stopping — fine.
        }
    }
    stopMeter();
    setSessionActive(false);
    setStripInterim("");
    setStripVisible(false);
    setStatus("Stopped.", "info");
    updateToolbar();
}

function toggle() {
    if (!supported) {
        ui.toast?.(
            "Voice Flow isn't supported in this browser. Try Chrome, Edge, or Safari, or use the Cascade desktop app.",
            { type: "warn" },
        );
        return;
    }
    if (listening) stop();
    else start();
}

// --- Audio level meter -------------------------------------------------------------
// A second, independent getUserMedia stream purely for the meter, so the
// listening strip has something honest to show even though the recognizer's
// own mic capture is invisible to page JS.

async function startMeter() {
    if (!navigator.mediaDevices?.getUserMedia) return; // no API — meter just stays flat
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!listening) {
        // stop() ran while the permission prompt was pending — release this
        // track immediately rather than leaving an orphaned mic stream open
        // that nothing will ever call stopMeter() to clean up.
        for (const track of stream.getTracks()) track.stop();
        return;
    }
    meterStream = stream;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    const source = audioCtx.createMediaStreamSource(meterStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) {
            const v = (data[i] - 128) / 128;
            sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        updateMeter(Math.min(1, rms * 4)); // scaled up — raw mic RMS reads as near-silent otherwise
        meterRaf = requestAnimationFrame(tick);
    };
    tick();
}

/** Tear down the meter and, critically, release the mic track — not just the AudioContext. */
function stopMeter() {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = null;
    analyser = null;
    if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
    }
    if (meterStream) {
        for (const track of meterStream.getTracks()) track.stop();
        meterStream = null;
    }
    updateMeter(0);
}

function updateMeter(level) {
    if (stripMeterFillEl) stripMeterFillEl.style.width = `${Math.round(level * 100)}%`;
}

// --- Listening strip ------------------------------------------------------------
// A small persistent readout: pulsing dot + level meter + interim text. Lives
// in ui.hud() when that exists (the shared overlay timers.js also uses), and
// falls back to living inside the panel body if hud() is ever unavailable —
// e.g. mid-boot while ui.js is still settling.

function buildStrip() {
    stripDotEl = el("span.voice-strip-dot", {
        "aria-hidden": "true",
        style: { display: "inline-block", width: "0.6em", height: "0.6em", borderRadius: "50%", background: "currentColor" },
    });
    stripTextEl = el("span.voice-strip-text", {
        style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    });
    stripMeterFillEl = el("span.voice-strip-meter-fill", {
        style: { display: "block", height: "100%", width: "0%", background: "currentColor", transition: "width 80ms linear" },
    });
    const meter = el(
        "span.voice-strip-meter",
        { style: { display: "inline-block", width: "48px", height: "0.6em", background: "rgba(128,128,128,0.25)", borderRadius: "3px", overflow: "hidden" } },
        stripMeterFillEl,
    );
    stripEl = el(
        "div.voice-strip",
        {
            role: "status",
            "aria-live": "polite",
            style: { display: "none", alignItems: "center", gap: "0.5em", padding: "0.25em 0.6em" },
        },
        stripDotEl,
        meter,
        stripTextEl,
    );
    return stripEl;
}

/** Mount the strip once, preferring ui.hud(); return true if it landed in the HUD. */
function mountStrip() {
    if (!stripEl) buildStrip();
    if (stripHost) return stripHost === "hud";
    let hudEl = null;
    try {
        hudEl = typeof ui.hud === "function" ? ui.hud() : null;
    } catch {
        hudEl = null;
    }
    if (hudEl) {
        hudEl.append(stripEl);
        stripHost = "hud";
    } else {
        stripHost = "pending"; // panel mount will pick this up
    }
    return stripHost === "hud";
}

function setStripVisible(visible) {
    if (!stripEl) mountStrip();
    stripEl.style.display = visible ? "flex" : "none";
}

function setStripInterim(text) {
    if (!stripTextEl) return;
    stripTextEl.textContent = text || (listening ? "(listening...)" : "");
}

/** Toggle the pulsing dot for "a session is actually connected right now" vs reconnecting. */
function setSessionActive(active) {
    if (!stripDotEl) return;
    if (active) {
        stripDotEl.style.color = "#f43f5e"; // --neg — recording red
        if (!pulseAnim && stripDotEl.animate) {
            pulseAnim = stripDotEl.animate(
                [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }],
                { duration: 1200, iterations: Infinity },
            );
        }
    } else {
        pulseAnim?.cancel();
        pulseAnim = null;
        stripDotEl.style.color = listening ? "#fbbf24" : ""; // amber while reconnecting
    }
}

// --- Panel ------------------------------------------------------------------------

function modeLabel(mode) {
    return { off: "Off — transcript only", assist: "Assist — trigger words only", full: "Full — every phrase" }[mode] ?? mode;
}

function setMode(mode) {
    if (!["off", "assist", "full"].includes(mode)) return;
    settings.mode = mode;
    saveSettings();
    renderModeButtons();
    ui.toast?.(`Voice Flow capture: ${modeLabel(mode)}`, { type: "info", ms: 1600 });
}

function cycleMode() {
    const order = ["off", "assist", "full"];
    setMode(order[(order.indexOf(settings.mode) + 1) % order.length]);
}

function setStatus(message, kind = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
}

function renderModeButtons() {
    if (!modeRowEl) return;
    clear(modeRowEl);
    for (const mode of ["off", "assist", "full"]) {
        const active = settings.mode === mode;
        modeRowEl.append(
            el(
                "button.voice-mode-btn",
                {
                    type: "button",
                    "aria-pressed": active ? "true" : "false",
                    style: {
                        fontWeight: active ? "700" : "400",
                        textDecoration: active ? "underline" : "none",
                        marginRight: "0.5em",
                    },
                    onClick: () => setMode(mode),
                },
                mode === "off" ? "Off" : mode === "assist" ? "Assist" : "Full",
            ),
        );
    }
}

function parseTriggersInput(raw) {
    return raw
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean);
}

async function clearTranscript() {
    const ok = await (ui.confirm
        ? ui.confirm("Clear the entire voice transcript for this round? This can be undone with Undo.", {
              title: "Clear voice transcript",
              confirmLabel: "Clear",
              danger: true,
          })
        : Promise.resolve(true));
    if (!ok) return;
    store.commit(
        (round) => {
            const cascade = round.cascade || (round.cascade = {});
            cascade.transcript = [];
        },
        { label: "Clear voice transcript" },
    );
    renderTranscript();
}

function formatTranscriptText(entries) {
    const lines = [];
    let lastSpeech;
    for (const entry of entries) {
        const speech = entry.speechId || "Unassigned";
        if (speech !== lastSpeech) {
            lines.push(`== ${speech} ==`);
            lastSpeech = speech;
        }
        lines.push(`[${new Date(entry.at).toLocaleTimeString()}] ${entry.text}`);
    }
    return lines.join("\n");
}

function getTranscript() {
    return store.cascade?.transcript ?? [];
}

function renderTranscript() {
    if (!transcriptListEl) return;
    clear(transcriptListEl);
    const query = (searchInputEl?.value || "").trim().toLowerCase();
    const entries = getTranscript().filter((e) => !query || e.text.toLowerCase().includes(query));
    if (!entries.length) {
        transcriptListEl.append(
            el("p.voice-transcript-empty", { style: { opacity: "0.6" } }, query ? "No matches." : "No transcript yet — press Start."),
        );
        return;
    }
    let lastSpeech;
    for (const entry of entries) {
        const speech = entry.speechId || "Unassigned";
        if (speech !== lastSpeech) {
            transcriptListEl.append(el("h4.voice-transcript-heading", { style: { margin: "0.75em 0 0.25em" } }, speech));
            lastSpeech = speech;
        }
        transcriptListEl.append(
            el(
                "div.voice-transcript-line",
                {
                    role: "button",
                    tabIndex: 0,
                    title: "Click to insert into the grid",
                    style: { cursor: "pointer", display: "flex", gap: "0.5em", padding: "0.15em 0" },
                    onClick: () => bus.emit("grid:insertText", { text: entry.text, newRow: true }),
                    onKeydown: (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            bus.emit("grid:insertText", { text: entry.text, newRow: true });
                        }
                    },
                },
                el("span.voice-transcript-time", { style: { opacity: "0.6", flexShrink: "0" } }, new Date(entry.at).toLocaleTimeString()),
                el("span.voice-transcript-text", {}, entry.text),
            ),
        );
    }
}

async function copyTranscript() {
    const query = (searchInputEl?.value || "").trim().toLowerCase();
    const entries = getTranscript().filter((e) => !query || e.text.toLowerCase().includes(query));
    const text = formatTranscriptText(entries);
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = el("textarea", { style: { position: "fixed", left: "-9999px" } }, text);
            document.body.append(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        ui.toast?.("Transcript copied.", { type: "success" });
    } catch (err) {
        ui.toast?.(`Couldn't copy transcript: ${err.message}`, { type: "error" });
    }
}

function downloadTranscript() {
    const text = formatTranscriptText(getTranscript());
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`voice-transcript-${stamp}.txt`, text || "(empty)", "text/plain");
}

function buildControls() {
    modeRowEl = el("div.voice-mode-row", { style: { margin: "0.5em 0" } });
    renderModeButtons();

    const langInput = el("input.voice-lang-input", {
        type: "text",
        value: settings.lang,
        "aria-label": "Recognition language (BCP-47 tag)",
        style: { width: "7em" },
        onChange: (e) => {
            const value = e.target.value.trim() || defaultLang();
            settings.lang = value;
            e.target.value = value;
            saveSettings();
            // Language only takes effect on the next session — restart now
            // if we're already listening so the change isn't silently stale.
            if (listening && recognition) {
                try {
                    recognition.stop();
                } catch {
                    // onend will still fire and restart with the new language.
                }
            }
        },
    });

    const triggersInput = el("textarea.voice-triggers-input", {
        rows: 2,
        "aria-label": "Keyword catcher trigger words, one per line or comma-separated",
        style: { width: "100%", boxSizing: "border-box" },
        onChange: (e) => {
            const parsed = parseTriggersInput(e.target.value);
            settings.triggers = parsed.length ? parsed : [...DEFAULT_TRIGGERS];
            saveSettings();
        },
    });
    triggersInput.value = settings.triggers.join(", ");

    const resetTriggersBtn = el(
        "button.voice-reset-triggers",
        {
            type: "button",
            onClick: () => {
                settings.triggers = [...DEFAULT_TRIGGERS];
                triggersInput.value = settings.triggers.join(", ");
                saveSettings();
            },
        },
        "Reset to defaults",
    );

    const startStopBtn = el(
        "button.voice-start-stop",
        {
            type: "button",
            disabled: !supported,
            onClick: () => toggle(),
        },
        listening ? "Stop" : "Start",
    );
    startStopBtn.dataset.role = "start-stop";
    // Toggling can also happen from the toolbar button or the Mod+Shift+V
    // chord, not just this button — updateToolbar() keeps this label in sync
    // with whichever path the debater actually used.
    startStopBtnEl = startStopBtn;

    statusEl = el("div.voice-status", { style: { opacity: "0.8", minHeight: "1.2em" } });

    return el(
        "div.voice-controls",
        {},
        el("label", {}, "Capture mode"),
        modeRowEl,
        el(
            "div.voice-row",
            { style: { display: "flex", gap: "1em", alignItems: "center", flexWrap: "wrap", margin: "0.5em 0" } },
            startStopBtn,
            el("label", { style: { display: "flex", gap: "0.4em", alignItems: "center" } }, "Language", langInput),
        ),
        el("label", {}, "Keyword catcher (forces a new row when a phrase starts with one of these)"),
        triggersInput,
        resetTriggersBtn,
        statusEl,
    );
}

function buildTranscriptSection() {
    searchInputEl = el("input.voice-search", {
        type: "search",
        placeholder: "Search transcript...",
        "aria-label": "Search voice transcript",
        style: { width: "100%", boxSizing: "border-box", margin: "0.5em 0" },
        onInput: debounce(() => renderTranscript(), 150),
    });
    const copyBtn = el("button.voice-copy", { type: "button", onClick: () => copyTranscript() }, "Copy");
    const downloadBtn = el("button.voice-download", { type: "button", onClick: () => downloadTranscript() }, "Download .txt");
    const clearBtn = el("button.voice-clear", { type: "button", onClick: () => clearTranscript() }, "Clear transcript");
    transcriptListEl = el("div.voice-transcript-list", { style: { maxHeight: "40vh", overflowY: "auto" } });
    renderTranscript();
    return el(
        "div.voice-transcript-section",
        {},
        el("h3", {}, "Transcript"),
        searchInputEl,
        el("div.voice-transcript-actions", { style: { display: "flex", gap: "0.5em", margin: "0.5em 0" } }, copyBtn, downloadBtn, clearBtn),
        transcriptListEl,
    );
}

function mountPanel(container) {
    panelBodyEl = container;
    clear(container);
    const privacy = el(
        "p.voice-privacy",
        { style: { fontSize: "0.9em", opacity: "0.85" } },
        "Recognition runs through your browser's own speech service — Cascade does not upload audio or " +
            "text anywhere. The transcript is stored only in this flow file, on this machine. Microphone " +
            "access is requested only when you press Start.",
    );
    container.append(el("h3", {}, "Voice Flow"), privacy);

    if (!supported) {
        container.append(
            el(
                "div.voice-unsupported",
                {},
                el("p", {}, "This browser does not support live speech recognition."),
                el(
                    "p",
                    {},
                    "Voice Flow works in Chrome, Edge, and Safari. On Firefox or another unsupported browser, " +
                        "use the Cascade desktop app instead, or keep flowing by hand — the rest of Cascade " +
                        "works exactly the same without this feature.",
                ),
            ),
        );
        return;
    }

    container.append(buildControls());

    // If the HUD wasn't available when we first tried to mount the strip,
    // this is the fallback home for it — otherwise it already lives in hud().
    if (!mountStrip() && stripEl && stripEl.parentElement !== container) {
        container.append(el("div.voice-strip-fallback", { style: { margin: "0.5em 0" } }, stripEl));
    }

    container.append(buildTranscriptSection());
}

// --- Toolbar & commands -------------------------------------------------------------

function updateToolbar() {
    ui.setToolbarButtonState?.("voice.toggle", {
        active: listening,
        disabled: !supported,
        label: listening ? "Voice: On" : "Voice",
    });
    if (startStopBtnEl) {
        startStopBtnEl.textContent = listening ? "Stop" : "Start";
        startStopBtnEl.disabled = !supported;
    }
}

function registerCommands() {
    registerAll([
        {
            id: "voice.toggle",
            title: "Voice Flow: start/stop listening",
            category: "Voice",
            keys: ["Mod+Shift+V"],
            icon: "●",
            run: () => toggle(),
        },
        {
            id: "voice.mode",
            title: "Voice Flow: cycle capture mode (Off / Assist / Full)",
            category: "Voice",
            run: () => cycleMode(),
        },
        {
            id: "voice.openPanel",
            title: "Voice Flow: open panel",
            category: "Voice",
            run: () => ui.showPanel?.(PANEL_ID),
        },
        {
            id: "voice.clearTranscript",
            title: "Voice Flow: clear transcript",
            category: "Voice",
            run: () => clearTranscript(),
        },
    ]);
}

// --- Boot -------------------------------------------------------------------------

/** Called once by main.js after the shell and store exist. Never throws. */
export function init() {
    loadSettings();

    ui.registerPanel({
        id: PANEL_ID,
        title: "Voice Flow",
        icon: "●",
        order: 40,
        mount: mountPanel,
        onShow: () => renderTranscript(),
    });

    ui.addToolbarButton({
        id: "voice.toggle",
        label: "Voice",
        icon: "●",
        title: supported ? `Voice Flow (${MOD_LABEL}+Shift+V)` : "Voice Flow (not supported in this browser)",
        slot: "right",
        onClick: () => toggle(),
        active: false,
    });

    registerCommands();

    bus.on("timer:speech", onTimerSpeech);

    // Best-effort resource hygiene: don't leave a mic stream open if the tab
    // closes mid-round. stop() is idempotent when nothing is running.
    if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", () => {
            if (listening) stop();
        });
    }

    updateToolbar();
}

export const voice = {
    init,
    start,
    stop,
    toggle,
    isListening: () => listening,
    isSupported: () => supported,
    setMode,
    getMode: () => settings?.mode,
    clearTranscript,
};

export default voice;
