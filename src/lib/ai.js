/**
 * On-device AI.
 *
 * Every AI feature on this site runs a language model inside the visitor's own
 * browser. No API key, no server, no quota, nothing uploaded.
 *
 * ## Model
 *
 * Llama 3.2 1B Instruct at 4-bit with fp16 compute. The previous choice —
 * SmolLM2-135M — was picked to minimise download size, and it was genuinely
 * unusable: asked to analyse a resolution it replied "(sitting down in the
 * chair)". At 135M parameters there is not enough model to follow an
 * instruction, and no amount of prompt engineering fixes that. 1B is the
 * smallest size that reliably produces real argument text.
 *
 * The cost is a much larger first download, which is why every caller now gets
 * detailed progress: a phase, a percentage, megabytes, elapsed time, and once
 * generation starts a live token count and tokens/sec. A long wait with a
 * visible number attached is tolerable; a long wait with a static "…" is not.
 *
 * ## Backends
 *
 * WebGPU with q4f16 is the default. `q4` (the WASM-oriented quantization) run
 * on WebGPU produces fluent-looking token soup, so the two are paired
 * deliberately: q4f16/WebGPU, or q4/WASM. WASM on a 1B model is slow but
 * correct, and is the honest fallback where WebGPU is missing.
 */

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const BACKEND_KEY = "d1.ai.backend";

export const MODEL_LABEL = "Llama 3.2 1B Instruct";

export const VARIANTS = {
    gpu: {
        repo: "onnx-community/Llama-3.2-1B-Instruct",
        dtype: "q4f16",
        device: "webgpu",
        approxMB: 1625,
        name: "WebGPU",
    },
    cpu: {
        repo: "onnx-community/Llama-3.2-1B-Instruct",
        dtype: "q4",
        device: "wasm",
        approxMB: 1500,
        name: "CPU",
    },
};

export const SYSTEM_PROMPTS = {
    res:
        "You are an experienced high school debate coach. The user gives you a debate " +
        "resolution. Reply with two short sections: 'AFFIRMATIVE' with 3 bullet points, " +
        "and 'NEGATIVE' with 3 bullet points. Each bullet is one concrete argument in one " +
        "sentence, naming the actual impact or mechanism. Do not describe actions, do not " +
        "roleplay, and do not restate the resolution.",
    faq:
        "You are an experienced high school debate coach answering a question from a " +
        "student. Answer in 2-4 short sentences of plain prose. Be concrete and specific " +
        "to competitive debate. Do not roleplay or describe actions.",
};

let pipelinePromise = null;
let pipelineRef = null;
let StreamerRef = null;
let activeController = null;

export function variant() {
    let forced = null;
    try {
        forced = localStorage.getItem(BACKEND_KEY);
    } catch (e) {
        /* private mode */
    }
    if (forced === "cpu") return VARIANTS.cpu;
    if (forced === "gpu") return VARIANTS.gpu;
    return "gpu" in navigator ? VARIANTS.gpu : VARIANTS.cpu;
}

export function setBackend(which) {
    try {
        localStorage.setItem(BACKEND_KEY, which);
    } catch (e) {
        /* private mode */
    }
    pipelinePromise = null;
    pipelineRef = null;
}

export function state() {
    if (pipelineRef) return "ready";
    if (pipelinePromise) return "loading";
    return "idle";
}

export function activeBackend() {
    return pipelineRef?.__backend ?? null;
}

/** True once the weights are in Cache Storage, so a reload is instant. */
export async function isCached() {
    try {
        if (!("caches" in window)) return false;
        const keys = await caches.keys();
        for (const key of keys) {
            const cache = await caches.open(key);
            const reqs = await cache.keys();
            if (reqs.some((r) => r.url.includes("Llama-3.2-1B") && r.url.endsWith(".onnx_data"))) {
                return true;
            }
            if (reqs.some((r) => r.url.includes("Llama-3.2-1B") && r.url.includes("model"))) {
                return true;
            }
        }
    } catch (e) {
        /* Cache API unavailable */
    }
    return false;
}

/**
 * Load the model.
 * @param {(p:{phase:string, pct:number, loadedMB:number, totalMB:number, backend:string})=>void} [onProgress]
 */
export function ensureModel(onProgress) {
    if (pipelinePromise) return pipelinePromise;

    const v = variant();
    pipelinePromise = (async () => {
        onProgress?.({ phase: "connecting", pct: 0, loadedMB: 0, totalMB: 0, backend: v.name });

        const { pipeline, TextStreamer } = await import(/* @vite-ignore */ LIB);
        StreamerRef = TextStreamer;

        const files = new Map();
        const generator = await pipeline("text-generation", v.repo, {
            dtype: v.dtype,
            device: v.device,
            progress_callback: (p) => {
                if (!p || !p.file) return;
                if (p.status === "progress" && typeof p.loaded === "number") {
                    files.set(p.file, { loaded: p.loaded, total: p.total || 0 });
                } else if (p.status === "done") {
                    const f = files.get(p.file);
                    if (f) f.loaded = f.total;
                }
                let loaded = 0;
                let total = 0;
                files.forEach((f) => {
                    loaded += f.loaded;
                    total += f.total;
                });
                onProgress?.({
                    phase: "downloading",
                    pct: total ? Math.min(99, Math.round((loaded / total) * 100)) : 0,
                    loadedMB: Math.round(loaded / 1048576),
                    totalMB: Math.round(total / 1048576),
                    backend: v.name,
                });
            },
        });

        // Compiling shaders / warming the graph happens on the first forward
        // pass, which would otherwise look like a hang on the first question.
        onProgress?.({ phase: "warming", pct: 100, loadedMB: 0, totalMB: 0, backend: v.name });
        try {
            await generator([{ role: "user", content: "hi" }], { max_new_tokens: 1 });
        } catch (e) {
            /* a failed warmup is not fatal; the real call will surface it */
        }

        generator.__backend = v.name;
        pipelineRef = generator;
        onProgress?.({ phase: "ready", pct: 100, loadedMB: 0, totalMB: 0, backend: v.name });
        return generator;
    })();

    pipelinePromise.catch(() => {
        pipelinePromise = null;
    });

    return pipelinePromise;
}

/** Stop the generation in flight, if any. */
export function stop() {
    activeController?.abort();
    activeController = null;
}

/**
 * Generate a reply.
 * @param {Array<{role:string, content:string}>} messages
 * @param {{onToken?:(text:string)=>void, onStats?:(s:{tokens:number, ms:number, tps:number})=>void, maxTokens?:number}} opts
 */
export async function generate(messages, { onToken, onStats, maxTokens = 320 } = {}) {
    const generator = pipelineRef ?? (await ensureModel());

    activeController = new AbortController();
    const { signal } = activeController;

    let text = "";
    let tokens = 0;
    const started = performance.now();
    let lastStat = 0;

    const streamer = StreamerRef
        ? new StreamerRef(generator.tokenizer, {
              skip_prompt: true,
              skip_special_tokens: true,
              callback_function: (chunk) => {
                  text += chunk;
                  tokens += 1;
                  onToken?.(text);
                  const now = performance.now();
                  // Throttled so a fast GPU does not re-render the stats line
                  // on every single token.
                  if (now - lastStat > 200) {
                      lastStat = now;
                      const ms = now - started;
                      onStats?.({ tokens, ms, tps: +(tokens / (ms / 1000)).toFixed(1) });
                  }
              },
          })
        : null;

    // Greedy decoding: on a 1B model at 4-bit, sampling adds noise without
    // adding much variety worth having for this task.
    const out = await generator(messages, {
        max_new_tokens: maxTokens,
        do_sample: false,
        repetition_penalty: 1.1,
        streamer,
        signal,
    });

    const ms = performance.now() - started;
    onStats?.({ tokens, ms, tps: +(tokens / (ms / 1000)).toFixed(1) });
    activeController = null;

    let final = text;
    try {
        const generated = out[0].generated_text;
        if (Array.isArray(generated)) final = generated.at(-1).content || text;
        else if (typeof generated === "string" && !text) final = generated;
    } catch (e) {
        /* keep whatever streamed */
    }
    return (final || "").trim();
}

export function describeFailure(err) {
    if (err && /abort/i.test(String(err.message || err))) return "Stopped.";
    if (!navigator.onLine) {
        return (
            "The model has not been downloaded yet and you are offline. Reconnect once to " +
            "fetch it, then it works offline forever."
        );
    }
    if (err && /out of memory|allocation|buffer/i.test(String(err.message || err))) {
        return (
            "This browser ran out of memory loading the model. Close some tabs and try again, " +
            "or switch to CPU mode with the link below — it is slower but needs less at once."
        );
    }
    return (
        "The model could not run in this browser. It needs a recent Chrome, Edge or Safari " +
        "with WebGPU and about 1 GB free — everything else on the site works without it."
    );
}
