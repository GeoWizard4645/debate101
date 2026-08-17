/**
 * The shared on-device chat surface, used by both Resolution AI and the FAQ
 * mentor. The model runs in the visitor's browser; see lib/ai.js.
 *
 * The status line is the point of this component as much as the messages are.
 * A local model has two long waits — a one-time weight download measured in
 * hundreds of megabytes, and a per-answer generation measured in seconds — and
 * both previously showed a single static "…". Every phase now reports what it
 * is doing, how far along it is, how long it has taken, and for generation the
 * live token count and speed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as ai from "../lib/ai.js";
import { route, ENGINE_STATS } from "../lib/debateEngine.js";
import { prefetchWhenIdle } from "../lib/modelPrefetch.js";
import { Icon } from "./Chrome.jsx";

const PHASE_LABEL = {
    connecting: "Connecting",
    downloading: "Downloading model",
    warming: "Warming up",
    thinking: "Thinking",
    writing: "Writing",
};

/** mm:ss from milliseconds. */
function clock(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Render generated or engine text with minimal, safe formatting.
 *
 * Processes line by line rather than block by block: the engine emits a bold
 * header immediately followed by a bullet run, and an all-or-nothing block test
 * rendered those as one paragraph full of literal asterisks.
 */
function Formatted({ text }) {
    const lines = String(text || "").split("\n");
    const out = [];
    let bullets = [];

    const flush = () => {
        if (!bullets.length) return;
        out.push(
            <ul className="chat-bullets" key={`ul-${out.length}`}>
                {bullets.map((l, i) => (
                    <li key={i}>{strong(l)}</li>
                ))}
            </ul>,
        );
        bullets = [];
    };

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            flush();
            return;
        }
        const bullet = /^[-*•]\s+/.test(trimmed);
        if (bullet) {
            bullets.push(trimmed.replace(/^[-*•]\s+/, ""));
        } else {
            flush();
            out.push(<p key={`p-${out.length}`}>{strong(trimmed)}</p>);
        }
    });
    flush();

    return <>{out}</>;
}

/** Turn **bold** into real emphasis; the model uses it for section headers. */
function strong(line) {
    const parts = String(line).split(/\*\*(.+?)\*\*/g);
    return parts.map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

/** Live elapsed timer, ticking while `running`. */
function useElapsed(running) {
    const [ms, setMs] = useState(0);
    const start = useRef(0);
    useEffect(() => {
        if (!running) return;
        start.current = performance.now();
        setMs(0);
        const id = setInterval(() => setMs(performance.now() - start.current), 100);
        return () => clearInterval(id);
    }, [running]);
    return ms;
}

export default function Chat({ kind, placeholder, intro, seedPrompts = [] }) {
    const [messages, setMessages] = useState(intro ? [{ role: "assistant", content: intro }] : []);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState(null);
    const [progress, setProgress] = useState(null);
    const [stats, setStats] = useState(null);
    const [modelState, setModelState] = useState(ai.state());
    const [cached, setCached] = useState(null);
    const historyRef = useRef([]);
    const scrollRef = useRef(null);
    const elapsed = useElapsed(busy || modelState === "loading");

    const v = ai.variant();

    useEffect(() => {
        ai.isCached().then(setCached);
        // An AI tool is on screen, so the model is wanted now rather than
        // eventually: start immediately and, because this page exists to use
        // it, without the device gate that governs the sitewide warm.
        prefetchWhenIdle(0, { force: true });
    }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [messages]);

    const onProgress = useCallback((p) => {
        setPhase(p.phase);
        setProgress(p.phase === "downloading" ? p : null);
    }, []);

    const load = useCallback(async () => {
        if (ai.state() !== "idle") return;
        setModelState("loading");
        try {
            await ai.ensureModel(onProgress);
            setModelState("ready");
            setCached(true);
        } catch (e) {
            console.error("[local-ai]", e);
            setModelState("idle");
        } finally {
            setPhase(null);
            setProgress(null);
        }
    }, [onProgress]);

    async function ask(question) {
        const q = (question ?? input).trim();
        if (!q || busy) return;

        setInput("");
        setStats(null);
        setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
        const replyAt = messages.length + 1;
        const patch = (content, meta) =>
            setMessages((m) => m.map((msg, i) => (i === replyAt ? { ...msg, content, meta } : msg)));

        // Layer 1 and 2: the deterministic engine. When it is confident the
        // model is never loaded at all — the answer is instant and exact.
        const decision = route(kind, q);
        if (decision.mode === "answer") {
            historyRef.current.push({ role: "user", content: q });
            historyRef.current.push({ role: "assistant", content: decision.text });
            patch(decision.text, { instant: true, source: decision.source });
            return;
        }

        setBusy(true);
        try {
            if (ai.state() !== "ready") {
                setModelState("loading");
                await ai.ensureModel(onProgress);
                setModelState("ready");
                setCached(true);
            }

            setPhase("thinking");
            historyRef.current.push({ role: "user", content: q });
            if (historyRef.current.length > 6) {
                historyRef.current.splice(0, historyRef.current.length - 6);
            }

            // Layer 3: the model — but handed everything the engine already
            // worked out, so it writes less and writes it better.
            const system = ai.SYSTEM_PROMPTS[kind] ?? ai.SYSTEM_PROMPTS.faq;
            const payload = [
                {
                    role: "system",
                    content: decision.context
                        ? `${system}\n\nReference material you should rely on: ${decision.context}`
                        : system,
                },
            ].concat(historyRef.current);

            let firstToken = true;
            const final = await ai.generate(payload, {
                maxTokens: kind === "res" ? 300 : 200,
                onToken: (text) => {
                    if (firstToken) {
                        firstToken = false;
                        setPhase("writing");
                    }
                    patch(text);
                },
                onStats: setStats,
            });

            const answer = final || "That came back empty — try rephrasing the question.";
            historyRef.current.push({ role: "assistant", content: answer });
            patch(answer, { source: decision.source });
        } catch (e) {
            console.error("[local-ai]", e);
            patch(ai.describeFailure(e));
        } finally {
            setBusy(false);
            setPhase(null);
            setProgress(null);
        }
    }

    const backend = ai.activeBackend() ?? v.name;
    const working = busy || modelState === "loading";

    return (
        <div className="chat">
            <div className="chat-log" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div key={i} className={`chat-msg chat-${m.role}`}>
                        {m.role === "assistant" && (
                            <p className="chat-who mono">
                                {m.meta?.instant ? "Instant · debate engine" : "On-device model"}
                                {m.meta?.instant && <span className="chat-badge">0 tokens</span>}
                            </p>
                        )}
                        <div className="chat-body">
                            {m.content ? (
                                <Formatted text={m.content} />
                            ) : (
                                <span className="chat-waiting mono">
                                    {PHASE_LABEL[phase] ?? "Starting"}
                                    <span className="chat-ellipsis" aria-hidden="true" />
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Live activity strip — phase, progress, timer, tokens. */}
            {working && (
                <div className="chat-activity" role="status" aria-live="polite">
                    <span className="chat-phase">
                        <span className="chat-pulse" aria-hidden="true" />
                        {PHASE_LABEL[phase] ?? "Working"}
                    </span>

                    {progress && (
                        <>
                            <span className="chat-bar" aria-hidden="true">
                                <span style={{ transform: `scaleX(${(progress.pct || 0) / 100})` }} />
                            </span>
                            <span className="mono">
                                {progress.pct}% · {progress.loadedMB}
                                {progress.totalMB ? `/${progress.totalMB}` : ""} MB
                            </span>
                        </>
                    )}

                    {stats && !progress && (
                        <span className="mono">
                            {stats.tokens} tokens · {stats.tps} tok/s
                        </span>
                    )}

                    <span className="mono chat-timer">{clock(elapsed)}</span>

                    {busy && (
                        <button className="chat-stop mono" onClick={() => ai.stop()}>
                            Stop
                        </button>
                    )}
                </div>
            )}

            {seedPrompts.length > 0 && messages.length <= 1 && !working && (
                <div className="chat-seeds">
                    {seedPrompts.map((s) => (
                        <button key={s} className="seed" onClick={() => ask(s)} disabled={busy}>
                            {s}
                        </button>
                    ))}
                </div>
            )}

            <div className="chat-input">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && ask()}
                    placeholder={placeholder}
                    disabled={busy}
                    aria-label={placeholder}
                />
                <button className="btn btn-sm" onClick={() => ask()} disabled={busy || !input.trim()}>
                    {busy ? "Working" : "Send"} <Icon name="arrow" size={13} />
                </button>
            </div>

            <p className="chat-status mono">
                <span className="chat-engine">
                    Debate engine: {ENGINE_STATS.glossaryTerms} terms · {ENGINE_STATS.domains} topic
                    areas · {ENGINE_STATS.arguments} arguments — answers instantly where it can.
                </span>
                <br />
                {modelState === "ready" ? (
                    <>
                        <b className="chat-dot">●</b> {ai.MODEL_LABEL} · {backend} — runs on your
                        device, nothing uploaded.{" "}
                        <button
                            className="linkish"
                            onClick={() => {
                                ai.setBackend(backend === "WebGPU" ? "cpu" : "gpu");
                                setModelState("idle");
                            }}
                        >
                            {backend === "WebGPU" ? "Answers look wrong? Use CPU mode" : "Try GPU mode (faster)"}
                        </button>
                    </>
                ) : (
                    <>
                        {ai.MODEL_LABEL} runs in your browser · ~{v.approxMB} MB,{" "}
                        {cached ? "already downloaded — loads in seconds" : "downloading in the background"} · {v.name}
                        {modelState === "idle" && (
                            <>
                                {" · "}
                                <button className="linkish" onClick={load}>
                                    {cached ? "Load it" : "Download it now"}
                                </button>
                            </>
                        )}
                    </>
                )}
            </p>
        </div>
    );
}
