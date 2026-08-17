/**
 * The shared on-device chat surface, used by both Resolution AI and the FAQ
 * mentor. The model runs in the visitor's browser; see lib/ai.js.
 */

import { useEffect, useRef, useState } from "react";
import * as ai from "../lib/ai.js";
import { Icon } from "./Chrome.jsx";

/** Render the model's plain text with minimal, safe formatting. */
function Formatted({ text }) {
    const blocks = String(text || "").split(/\n{2,}/);
    return (
        <>
            {blocks.map((block, bi) => {
                const lines = block.split("\n");
                const bulleted = lines.every((l) => /^\s*[-*•]\s+/.test(l)) && lines.length > 1;
                if (bulleted) {
                    return (
                        <ul className="chat-bullets" key={bi}>
                            {lines.map((l, li) => <li key={li}>{l.replace(/^\s*[-*•]\s+/, "")}</li>)}
                        </ul>
                    );
                }
                return <p key={bi}>{block}</p>;
            })}
        </>
    );
}

export default function Chat({ kind, placeholder, intro, seedPrompts = [] }) {
    const [messages, setMessages] = useState(intro ? [{ role: "assistant", content: intro }] : []);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);
    const [modelState, setModelState] = useState(ai.state());
    const historyRef = useRef([]);
    const scrollRef = useRef(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [messages]);

    const v = ai.variant();

    async function preload() {
        if (ai.state() !== "idle") return;
        setModelState("loading");
        try {
            await ai.ensureModel((pct, mb, backend) =>
                setStatus(`Downloading — ${pct}% (${mb} MB) · ${backend}`));
            setStatus(null);
            setModelState("ready");
        } catch (e) {
            setStatus("The model could not load. Everything else on the site still works.");
            setModelState("idle");
        }
    }

    async function ask(question) {
        const q = (question ?? input).trim();
        if (!q || busy) return;

        setInput("");
        setBusy(true);
        setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);

        const replyAt = messages.length + 1;
        const patch = (content) =>
            setMessages((m) => m.map((msg, i) => (i === replyAt ? { ...msg, content } : msg)));

        try {
            if (ai.state() !== "ready") {
                patch(`Downloading the model (about ${v.approxMB} MB). This happens once — after that it works offline.`);
                setModelState("loading");
                await ai.ensureModel((pct, mb, backend) => {
                    setStatus(`Downloading — ${pct}% (${mb} MB) · ${backend}`);
                    patch(`Downloading the model — ${pct}% (${mb} MB read). One time only.`);
                });
                setStatus(null);
                setModelState("ready");
            }

            historyRef.current.push({ role: "user", content: q });
            if (historyRef.current.length > 6) historyRef.current.splice(0, historyRef.current.length - 6);

            const payload = [{ role: "system", content: ai.SYSTEM_PROMPTS[kind] ?? ai.SYSTEM_PROMPTS.faq }]
                .concat(historyRef.current);

            patch("");
            const final = await ai.generate(payload, {
                onToken: patch,
                maxTokens: kind === "res" ? 200 : 140,
            });

            const answer = final || "That came back empty — try rephrasing the question.";
            historyRef.current.push({ role: "assistant", content: answer });
            patch(answer);
        } catch (e) {
            console.error("[local-ai]", e);
            patch(ai.describeFailure());
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="chat">
            <div className="chat-log" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div key={i} className={`chat-msg chat-${m.role}`}>
                        {m.role === "assistant" && <p className="chat-who mono">On-device model</p>}
                        <div className="chat-body">
                            {m.content ? <Formatted text={m.content} /> : <span className="chat-dots">…</span>}
                        </div>
                    </div>
                ))}
            </div>

            {seedPrompts.length > 0 && messages.length <= 1 && (
                <div className="chat-seeds">
                    {seedPrompts.map((s) => (
                        <button key={s} className="seed" onClick={() => ask(s)} disabled={busy}>{s}</button>
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
                    {busy ? "Thinking" : "Send"} <Icon name="arrow" size={13} />
                </button>
            </div>

            <p className="chat-status mono">
                {status ? status
                    : modelState === "ready"
                        ? `● ${ai.MODEL_LABEL} · ${ai.activeBackend() ?? v.name} — runs on your device, nothing uploaded. It is a very small model, so check anything it tells you.`
                        : `Runs a small AI model in your browser · ~${v.approxMB} MB, downloaded once · ${v.name} · `}
                {modelState === "idle" && !status && (
                    <button className="linkish" onClick={preload}>Load it now</button>
                )}
                {modelState === "ready" && (
                    <button
                        className="linkish"
                        onClick={() => {
                            const next = (ai.activeBackend() ?? v.name) === "WebGPU" ? "cpu" : "gpu";
                            ai.setBackend(next);
                            setModelState("idle");
                            setStatus(null);
                        }}
                    >
                        {(ai.activeBackend() ?? v.name) === "WebGPU" ? "Answers look wrong? Use CPU mode" : "Try GPU mode (faster)"}
                    </button>
                )}
            </p>
        </div>
    );
}
