/**
 * AI features: Resolution AI and the FAQ mentor.
 *
 * These used to run a small model (SmolLM2-360M) inside the visitor's browser.
 * That was private and free, but the answers were weak. They now call a real
 * model — openai/gpt-oss-20b on Groq — through a small Cloudflare Worker that
 * holds the API key server-side (see worker/). The key never ships to the
 * browser, which matters: this is a static site, and the last key that shipped
 * to the browser was scraped and abused.
 *
 * The Worker URL is not a secret. It is injected at deploy time: the Pages
 * workflow writes config.js from the GROQ_WORKER_URL repo variable, and
 * index.html loads config.js before the bundle. In dev, create a gitignored
 * config.js in the repo root with the same global.
 *
 * The deterministic debate engine (debateEngine.js) still answers the
 * majority of questions exactly and instantly; the model only handles what
 * falls through.
 */

// The deployed debate101-ai Worker. config.js (written at deploy time from
// the GROQ_WORKER_URL repo variable) can override it without a rebuild.
const FALLBACK_ENDPOINT = "https://debate101-ai.vivaan-shahani.workers.dev";

export const MODEL_LABEL = "GPT-OSS 20B · Groq";

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

let activeController = null;

function endpoint() {
    try {
        if (typeof window !== "undefined" && window.DEBATE101_AI_ENDPOINT) {
            return window.DEBATE101_AI_ENDPOINT;
        }
    } catch (e) {
        /* no window */
    }
    return FALLBACK_ENDPOINT;
}

/** Stop the generation in flight, if any. */
export function stop() {
    activeController?.abort();
    activeController = null;
}

/**
 * Generate a reply, streaming tokens from the worker (SSE).
 * @param {Array<{role:string, content:string}>} messages
 * @param {{onToken?:(text:string)=>void, onStats?:(s:{tokens:number, ms:number, tps:number})=>void, maxTokens?:number}} opts
 */
export async function generate(messages, { onToken, onStats, maxTokens = 320 } = {}) {
    activeController = new AbortController();
    const { signal } = activeController;

    const started = performance.now();
    let text = "";
    let tokens = 0;
    let lastStat = 0;

    const res = await fetch(endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, maxTokens }),
        signal,
    });

    if (!res.ok || !res.body) {
        let message = `Request failed (${res.status}).`;
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch (e) {
            /* non-JSON error body */
        }
        activeController = null;
        throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Server-sent events: "data: {json}\n\n" lines, terminated by [DONE].
            let sep;
            while ((sep = buffer.indexOf("\n\n")) !== -1) {
                const event = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                for (const line of event.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (payload === "[DONE]") continue;
                    let delta;
                    try {
                        delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
                    } catch (e) {
                        continue;
                    }
                    if (!delta) continue;
                    text += delta;
                    tokens += 1;
                    onToken?.(text);
                    const now = performance.now();
                    // Throttled so a fast stream does not re-render the stats
                    // line on every single token.
                    if (now - lastStat > 200) {
                        lastStat = now;
                        const ms = now - started;
                        onStats?.({ tokens, ms, tps: +(tokens / (ms / 1000)).toFixed(1) });
                    }
                }
            }
        }
    } finally {
        reader.cancel().catch(() => {});
        activeController = null;
    }

    const ms = performance.now() - started;
    onStats?.({ tokens, ms, tps: +(tokens / (ms / 1000)).toFixed(1) });
    return (text || "").trim();
}

export function describeFailure(err) {
    if (err && /abort/i.test(String(err.message || err))) return "Stopped.";
    if (!navigator.onLine) {
        return "You are offline. The debate engine still answers instantly; the model needs a connection.";
    }
    const msg = String(err?.message || "");
    if (/daily limit|capacity|rate-limited/i.test(msg)) return msg;
    return (
        "The model could not be reached right now. Try again in a moment — " +
        "everything else on the site works without it."
    );
}
