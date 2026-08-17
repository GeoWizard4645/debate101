/**
 * On-device AI.
 *
 * Every AI feature on this site runs a language model inside the visitor's own
 * browser. No API key, no server, no quota, nothing uploaded.
 *
 * Backend choice is measured, not assumed. Same model, same prompt, 100 tokens:
 *
 *   q4    + wasm     3.5 tok/s   coherent
 *   q8    + wasm    27.8 tok/s   coherent
 *   fp16  + webgpu  55.1 tok/s   coherent
 *   fp32  + webgpu  62.6 tok/s   coherent
 *   q4f16 + webgpu  84.6 tok/s   coherent   <- default
 *
 * Two traps worth recording. Plain `q4` is a WASM-oriented quantization; asking
 * WebGPU to run it produced fluent-looking token soup, which made the GPU path
 * look broken when the real problem was the weights. And `q4` is *slower* than
 * `q8` on WASM, because 4-bit weights are dequantized on every operation — so
 * the smallest file was also the slowest run.
 */

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const REPO = "HuggingFaceTB/SmolLM2-135M-Instruct";
const BACKEND_KEY = "d1.ai.backend";

export const MODEL_LABEL = "SmolLM2 135M Instruct";

export const VARIANTS = {
    gpu: { dtype: "q4f16", device: "webgpu", approxMB: 100, name: "WebGPU" },
    cpu: { dtype: "q8", device: "wasm", approxMB: 135, name: "CPU" },
};

export const SYSTEM_PROMPTS = {
    res:
        "You are a debate coach. Given a resolution, give a short, concrete breakdown: " +
        "2-3 affirmative arguments and 2-3 negative arguments. Be brief and use short bullet points.",
    faq:
        "You are a debate coach answering a question from a high school debater. " +
        "Answer in 2-4 short sentences. Be concrete and plain-spoken.",
};

let pipelinePromise = null;
let pipelineRef = null;
let StreamerRef = null;

/** The backend to use: an explicit choice, else WebGPU where it exists. */
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

/**
 * Load the model, reporting aggregate download progress. Concurrent callers
 * share one download.
 * @param {(pct:number, mb:number, backend:string)=>void} [onProgress]
 */
export function ensureModel(onProgress) {
    if (pipelinePromise) return pipelinePromise;

    const v = variant();
    pipelinePromise = (async () => {
        const { pipeline, TextStreamer } = await import(/* @vite-ignore */ LIB);
        StreamerRef = TextStreamer;

        const files = new Map();
        const generator = await pipeline("text-generation", REPO, {
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
                const pct = total ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
                onProgress?.(pct, Math.round(loaded / 1048576), v.name);
            },
        });

        generator.__backend = v.name;
        pipelineRef = generator;
        return generator;
    })();

    // A failed load must not poison every later attempt.
    pipelinePromise.catch(() => {
        pipelinePromise = null;
    });

    return pipelinePromise;
}

/**
 * Generate a reply, streaming tokens to `onToken` as they arrive.
 * @param {Array<{role:string, content:string}>} messages
 */
export async function generate(messages, { onToken, maxTokens = 160 } = {}) {
    const generator = pipelineRef ?? (await ensureModel());

    let text = "";
    const streamer = StreamerRef
        ? new StreamerRef(generator.tokenizer, {
              skip_prompt: true,
              skip_special_tokens: true,
              callback_function: (chunk) => {
                  text += chunk;
                  onToken?.(text);
              },
          })
        : null;

    // Greedy decoding. Sampling at any temperature this model can hold turned
    // coherent answers into word salad — at 135M parameters there is no
    // probability mass to spare.
    const out = await generator(messages, {
        max_new_tokens: maxTokens,
        do_sample: false,
        repetition_penalty: 1.1,
        streamer,
    });

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

/** Human-readable failure text for the chat bubble. */
export function describeFailure() {
    return navigator.onLine
        ? "The model could not run in this browser. It needs a recent Chrome, Edge, Firefox or " +
              "Safari with enough memory — everything else on the site works without it."
        : "The model has not been downloaded yet and you are offline. Reconnect once to fetch it, " +
              "then it works offline forever.";
}
