/**
 * debate101-ai — a tiny Cloudflare Worker in front of the Groq API.
 *
 * Why this exists: debate101.org is a fully static site on GitHub Pages, so
 * anything shipped to the browser is public. The site's AI chat therefore
 * cannot hold an API key (an earlier Gemini key committed to the repo was
 * scraped and abused, and Google suspended the project). This Worker holds
 * the Groq key as a server-side secret; the site talks only to the Worker.
 *
 * What it does:
 *   - accepts POST / with { messages, maxTokens? } from the site
 *   - injects the secret GROQ_API_KEY and the model server-side
 *   - clamps request size and token budget
 *   - rate-limits per visitor IP and caps total daily spend
 *   - streams the completion back as SSE
 *
 * What it cannot do: per-isolate counters are best-effort. Cloudflare may run
 * many isolates, so the limits below are a polite fence, not a hard wall. The
 * Groq free tier's own 1,000 requests/day quota is the real backstop.
 */

const ALLOWED_ORIGINS = new Set([
    "https://debate101.org",
    "https://www.debate101.org",
    "http://localhost:5173", // vite dev server
]);

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const MAX_COMPLETION_TOKENS = 512;

// Best-effort, per-isolate counters. They reset when the isolate recycles,
// which is fine: they exist to blunt casual abuse, not to meter exactly.
const perIp = new Map(); // ip -> { day, count }
let globalCount = { day: "", count: 0 };

function today() {
    return new Date().toISOString().slice(0, 10);
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function jsonError(status, message, origin) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
}

function limited(map, key, limit) {
    const day = today();
    let entry = map.get(key);
    if (!entry || entry.day !== day) {
        entry = { day, count: 0 };
        map.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit;
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin") || "";
        const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://debate101.org";

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(allowed) });
        }
        if (request.method !== "POST") {
            return jsonError(405, "POST only.", allowed);
        }
        if (!ALLOWED_ORIGINS.has(origin)) {
            return jsonError(403, "Origin not allowed.", allowed);
        }

        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipLimit = parseInt(env.PER_IP_DAILY_LIMIT || "20", 10);
        const globalLimit = parseInt(env.GLOBAL_DAILY_LIMIT || "900", 10);

        if (limited(perIp, ip, ipLimit)) {
            return jsonError(429, "Daily limit reached for this connection. Try again tomorrow.", allowed);
        }
        if (globalCount.day !== today()) globalCount = { day: today(), count: 0 };
        globalCount.count += 1;
        if (globalCount.count > globalLimit) {
            return jsonError(429, "The AI is at capacity for today. Try again tomorrow.", allowed);
        }

        let body;
        try {
            const text = await request.text();
            if (text.length > MAX_BODY_BYTES) return jsonError(413, "Request too large.", allowed);
            body = JSON.parse(text);
        } catch {
            return jsonError(400, "Invalid JSON body.", allowed);
        }

        const messages = Array.isArray(body.messages) ? body.messages : null;
        if (!messages || messages.length === 0 || messages.length > MAX_MESSAGES) {
            return jsonError(400, `messages must be an array of 1-${MAX_MESSAGES} items.`, allowed);
        }
        for (const m of messages) {
            if (!m || typeof m.role !== "string" || typeof m.content !== "string") {
                return jsonError(400, "Each message needs string role and content.", allowed);
            }
            if (m.content.length > MAX_MESSAGE_CHARS) {
                return jsonError(400, "A message is too long.", allowed);
            }
        }

        const maxTokens = Math.min(
            Math.max(parseInt(body.maxTokens, 10) || 256, 1),
            MAX_COMPLETION_TOKENS,
        );

        let upstream;
        try {
            upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${env.GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: env.MODEL || "openai/gpt-oss-20b",
                    messages,
                    max_tokens: maxTokens,
                    stream: true,
                }),
            });
        } catch {
            return jsonError(502, "Could not reach the model provider.", allowed);
        }

        if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            console.error("groq upstream error", upstream.status, detail.slice(0, 500));
            const status = upstream.status === 429 ? 429 : 502;
            const message =
                upstream.status === 429
                    ? "The AI is rate-limited right now. Try again in a minute."
                    : "The model provider returned an error.";
            return jsonError(status, message, allowed);
        }

        return new Response(upstream.body, {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                ...corsHeaders(allowed),
            },
        });
    },
};
