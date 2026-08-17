/**
 * Model prefetch.
 *
 * The weights are well over a gigabyte, and the whole wait otherwise lands on
 * whoever asks the first question. This starts the real download as soon as the
 * site opens, so that by the time an AI tool is used it is already done or most
 * of the way there.
 *
 * ## Why this delegates to the library
 *
 * Two earlier designs fetched the weight URLs directly. Both were wrong.
 *
 * The first used HTTP Range requests to grab a fixed first slice. Measured
 * against the real host that is unsafe: a range returns `206` with
 * `content-range: bytes 0-99/2249` but only 72 bytes of body, because the range
 * applies to the compressed representation while the browser hands back
 * decompressed bytes. Reassembled chunks do not reconstitute the file, and the
 * blob would have been cached under the real URL — leaving the library to load
 * a corrupt model.
 *
 * The second fetched whole files, but had to *guess* which files those were.
 * It guessed wrong: the library pulls a different and larger set than
 * `onnx/model_q4f16.onnx`, so the prefetch warmed nothing and the real download
 * still started from zero on the first question.
 *
 * So this no longer touches URLs at all. It calls the same `ensureModel()` the
 * chat calls. The library resolves its own file list, streams into its own
 * cache, and reports real progress — and because `ensureModel()` returns one
 * shared promise, a visitor who opens an AI tool mid-download joins the
 * transfer already running instead of starting a second one.
 *
 * ## Restraint
 *
 * This spends a lot of someone's bandwidth before they have asked for anything.
 * It respects Save-Data, refuses on 2G, requires a device reporting at least
 * 8 GB of memory, waits for idle, and can be switched off outright.
 */

import * as ai from "./ai.js";

const PREF_KEY = "d1.ai.prefetch";

/**
 * `navigator.deviceMemory` is coarse and Chrome caps it at 8, so 8 is both
 * "8 GB" and "8 GB or more" — which makes `>= 8` the strictest honest reading
 * of "more than 8 GB". Browsers that do not implement it (Safari, Firefox)
 * report undefined; those are allowed through rather than excluded, since the
 * alternative is never prefetching for them at all.
 */
const MIN_DEVICE_MEMORY = 8;

let started = false;
const listeners = new Set();
let last = { phase: "idle", pct: 0, mb: 0, totalMb: 0 };

export function onPrefetch(fn) {
    listeners.add(fn);
    fn(last);
    return () => listeners.delete(fn);
}

function emit(state) {
    last = state;
    for (const fn of listeners) {
        try {
            fn(state);
        } catch (e) {
            /* a listener must not break the download */
        }
    }
}

export function prefetchState() {
    return last;
}

/** Whether prefetching is appropriate on this device and connection. */
export function shouldPrefetch() {
    try {
        if (localStorage.getItem(PREF_KEY) === "off") return false;
    } catch (e) {
        /* private mode — fall through */
    }
    if (typeof navigator === "undefined") return false;

    const c = navigator.connection;
    if (c) {
        // An explicit user preference for less data. Always honoured.
        if (c.saveData) return false;
        const type = c.effectiveType || "";
        if (type === "slow-2g" || type === "2g") return false;
    }
    if (typeof navigator.deviceMemory === "number" && navigator.deviceMemory < MIN_DEVICE_MEMORY) {
        return false;
    }
    return true;
}

export function setPrefetchEnabled(on) {
    try {
        localStorage.setItem(PREF_KEY, on ? "on" : "off");
    } catch (e) {
        /* private mode */
    }
}

/** Why prefetch is not running, for the UI to explain rather than sit silent. */
export function prefetchBlockedReason() {
    try {
        if (localStorage.getItem(PREF_KEY) === "off") return "turned off";
    } catch (e) {
        /* ignore */
    }
    const c = navigator.connection;
    if (c?.saveData) return "Data Saver is on";
    if (c && /2g/.test(c.effectiveType || "")) return "the connection is slow";
    if (typeof navigator.deviceMemory === "number" && navigator.deviceMemory < MIN_DEVICE_MEMORY) {
        return `this device reports ${navigator.deviceMemory} GB of memory`;
    }
    return null;
}

/**
 * Begin (or join) the real model download. Safe to call from anywhere and as
 * often as you like — `ensureModel` dedupes, so extra calls simply attach to
 * the transfer already in flight.
 */
export async function prefetch({ force = false } = {}) {
    if (!force && !shouldPrefetch()) return;
    if (started) return;
    started = true;

    try {
        await ai.ensureModel((p) => {
            emit({
                phase: p.phase,
                pct: p.pct ?? 0,
                mb: p.loadedMB ?? 0,
                totalMb: p.totalMB ?? 0,
            });
        });
        emit({ phase: "ready", pct: 100, mb: last.mb, totalMb: last.totalMb });
    } catch (e) {
        // A failed prefetch is invisible by design: the model still loads on
        // demand, just without the head start.
        console.debug("[prefetch]", e?.message ?? e);
        started = false;
        emit({ phase: "idle", pct: 0, mb: 0, totalMb: 0 });
    }
}

/**
 * Start at idle so the download never competes with first paint.
 * `delay` is a grace period after idle; an AI page passes 0.
 */
export function prefetchWhenIdle(delay = 2000, opts) {
    if (!opts?.force && !shouldPrefetch()) return;
    const go = () => prefetch(opts);
    if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => (delay ? setTimeout(go, delay) : go()), { timeout: 8000 });
    } else {
        setTimeout(go, delay + 1000);
    }
}
