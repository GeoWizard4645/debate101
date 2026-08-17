/**
 * Model prefetch.
 *
 * The weights are ~1 GB and the whole wait otherwise lands on whoever asks the
 * first question. This starts fetching them early — at idle, once the site has
 * painted — so that by the time an AI tool is opened a large part of the
 * download is already done, and opening the tool simply joins the download
 * already in flight rather than starting one.
 *
 * ## Why whole files rather than a byte budget
 *
 * The original design fetched a fixed first slice (~300 MB) with HTTP Range
 * requests and assembled the chunks later. Measured against the real host, that
 * is unsafe: a range request returns `206` with `content-range: bytes 0-99/2249`
 * but only 72 bytes of body, because the range applies to the *compressed*
 * representation while the browser hands back decompressed bytes. Reassembled
 * chunks would therefore not reconstitute the file, and because the assembled
 * blob gets written into the cache under the real URL, the library would later
 * load a corrupt model — a failure far worse than a slow first question.
 *
 * So: whole files, fetched in size order, streamed straight into the same
 * `transformers-cache` that @huggingface/transformers reads from. A file is
 * only ever cached once it has arrived complete. The staging is by *when* the
 * fetch starts rather than by how many bytes it takes.
 *
 * ## Restraint
 *
 * This spends someone else's bandwidth before they have asked for anything, so
 * it declines on Save-Data, metered or slow connections, and low-memory
 * devices, runs only at idle, and can be turned off outright.
 */

const CACHE_NAME = "transformers-cache";
const PREF_KEY = "d1.ai.prefetch";

const REPO = "onnx-community/Llama-3.2-1B-Instruct";
const BASE = `https://huggingface.co/${REPO}/resolve/main`;

/** Small files that gate startup. Cheap, and always worth having first. */
const META_FILES = [
    "config.json",
    "generation_config.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "tokenizer.json",
];

/** Weight files, in preference order. The first that exists is the one used. */
const WEIGHT_CANDIDATES = ["onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data"];

let controller = null;
let metaDone = false;
let weightsInFlight = null;
const listeners = new Set();

function emit(state) {
    for (const fn of listeners) {
        try {
            fn(state);
        } catch (e) {
            /* a listener must not break the download */
        }
    }
}

export function onPrefetch(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/* ------------------------------------------------------------ Politeness -- */

export function shouldPrefetch() {
    try {
        if (localStorage.getItem(PREF_KEY) === "off") return false;
    } catch (e) {
        /* private mode — fall through */
    }
    if (typeof navigator === "undefined" || !("caches" in window)) return false;

    const c = navigator.connection;
    if (c) {
        if (c.saveData) return false;
        const type = c.effectiveType || "";
        if (type === "slow-2g" || type === "2g" || type === "3g") return false;
    }
    // deviceMemory is coarse and in GB; below 4 the model itself will struggle,
    // so pulling a gigabyte down for it is pure waste.
    if (typeof navigator.deviceMemory === "number" && navigator.deviceMemory < 4) return false;
    return true;
}

export function setPrefetchEnabled(on) {
    try {
        localStorage.setItem(PREF_KEY, on ? "on" : "off");
    } catch (e) {
        /* private mode */
    }
    if (!on) cancel();
}

export function cancel() {
    controller?.abort();
    controller = null;
    weightsInFlight = null;
}

/* ----------------------------------------------------------------- Work --- */

async function cached(url) {
    try {
        const cache = await caches.open(CACHE_NAME);
        return Boolean(await cache.match(url));
    } catch (e) {
        return false;
    }
}

/**
 * Fetch one whole file into the library cache. Nothing is written until the
 * body has fully arrived, so an interrupted download leaves no partial entry
 * for the library to trip over.
 */
async function fetchWhole(url, signal, onBytes) {
    if (await cached(url)) return true;

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);

    // Stream so progress is reportable; the body is only committed at the end.
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(url, res);
        return true;
    }

    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onBytes?.(received, total);
    }

    const blob = new Blob(chunks, {
        type: res.headers.get("content-type") || "application/octet-stream",
    });
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(blob, { status: 200, headers: res.headers }));
    return true;
}

async function fetchMeta(signal) {
    if (metaDone) return;
    for (const name of META_FILES) {
        try {
            await fetchWhole(`${BASE}/${name}`, signal);
        } catch (e) {
            if (signal.aborted) throw e;
            // An optional config that 404s is not worth stopping the run for.
        }
    }
    metaDone = true;
    emit({ phase: "meta-ready" });
}

/** Which weight file this build needs. Probed once, cheaply. */
async function resolveWeightUrl(signal) {
    for (const path of WEIGHT_CANDIDATES) {
        const url = `${BASE}/${path}`;
        if (await cached(url)) return url;
        try {
            const res = await fetch(url, { method: "HEAD", signal });
            if (res.ok) return url;
        } catch (e) {
            if (signal.aborted) throw e;
        }
    }
    return `${BASE}/${WEIGHT_CANDIDATES[0]}`;
}

/**
 * Start (or join) the weights download. Returns the same promise to every
 * caller, so opening an AI tool mid-download joins the transfer already running
 * instead of starting a second one.
 */
function startWeights(signal) {
    if (weightsInFlight) return weightsInFlight;

    weightsInFlight = (async () => {
        const url = await resolveWeightUrl(signal);
        if (await cached(url)) {
            emit({ phase: "complete", pct: 100 });
            return true;
        }
        await fetchWhole(url, signal, (received, total) => {
            // CORS often hides content-length, in which case a percentage would
            // be invented. Report megabytes and leave pct null rather than
            // showing a progress bar pinned at 0%.
            emit({
                phase: "weights",
                pct: total ? Math.round((received / total) * 100) : null,
                mb: Math.round(received / 1048576),
                totalMb: total ? Math.round(total / 1048576) : null,
            });
        });
        emit({ phase: "complete", pct: 100 });
        return true;
    })();

    weightsInFlight.catch(() => {
        weightsInFlight = null;
    });
    return weightsInFlight;
}

/**
 * Run a prefetch stage.
 *   "stage1" — site open: metadata now, weights started at idle behind it.
 *   "stage2" — an AI tool is open: make sure both are running, and join them.
 */
export async function prefetch(stage = "stage1") {
    if (!shouldPrefetch()) return;
    if (!controller) controller = new AbortController();
    const { signal } = controller;

    try {
        await fetchMeta(signal);
        await startWeights(signal);
    } catch (e) {
        if (e?.name !== "AbortError") {
            // A failed prefetch is invisible by design: the model still loads
            // normally on demand, just without the head start.
            console.debug("[prefetch]", e?.message ?? e);
        }
    }
}

/** Kick a stage off when the browser is idle, never during first paint. */
export function prefetchWhenIdle(stage = "stage1", delay = 2500) {
    if (!shouldPrefetch()) return;
    const start = () => prefetch(stage);
    if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => setTimeout(start, delay), { timeout: 12000 });
    } else {
        setTimeout(start, delay + 1500);
    }
}

/** Whether the weights are already sitting in the cache. */
export async function weightsReady() {
    for (const path of WEIGHT_CANDIDATES) {
        if (await cached(`${BASE}/${path}`)) return true;
    }
    return false;
}
