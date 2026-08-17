/**
 * FAQ and mentor. The glossary is the authoritative, human-written answer set;
 * the chat below it is the on-device model for anything not covered.
 */

import { useMemo, useState } from "react";
import Chat from "../components/Chat.jsx";
import { Icon } from "../components/Chrome.jsx";
import Reveal from "../components/Reveal.jsx";

function Entry({ item, index }) {
    const [open, setOpen] = useState(false);
    return (
        <div className={`faq-item${open ? " is-open" : ""}`}>
            <button className="faq-q" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                <span className="mono faq-num">{String(index + 1).padStart(2, "0")}</span>
                <span className="faq-text">{item.q}</span>
                <span className="faq-mark" aria-hidden="true">{open ? "−" : "+"}</span>
            </button>
            {open && <div className="faq-a"><p>{item.a}</p></div>}
        </div>
    );
}

export default function Faq({ content }) {
    const faq = content?.faq ?? [];
    const [query, setQuery] = useState("");

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return faq;
        return faq.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(q));
    }, [faq, query]);

    return (
        <div className="page">
            <div className="wrap-narrow">
                <header className="page-head">
                    <p className="eyebrow">Glossary</p>
                    <h1 className="display">Frequently asked, <em>plainly answered.</em></h1>
                    <p className="lede">
                        The vocabulary of competitive debate, written for someone in their first season.
                    </p>
                </header>

                <div className="search-field" style={{ marginBottom: "2rem" }}>
                    <Icon name="search" size={15} />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search the glossary — kritik, topicality, spreading…"
                        aria-label="Search the FAQ"
                    />
                    {query && (
                        <button onClick={() => setQuery("")} aria-label="Clear search">
                            <Icon name="close" size={14} />
                        </button>
                    )}
                </div>

                <div className="faq-list">
                    {visible.map((item, i) => (
                        <Reveal key={item.q} delay={Math.min(i, 8) * 35}>
                            <Entry item={item} index={faq.indexOf(item)} />
                        </Reveal>
                    ))}
                    {visible.length === 0 && (
                        <p className="empty">
                            Nothing in the glossary matches that — try asking the mentor below.
                        </p>
                    )}
                </div>

                <section className="hub-cat">
                    <div className="hub-cat-head">
                        <h2>Ask the mentor</h2>
                        <span className="mono">On-device</span>
                    </div>
                    <Chat
                        kind="faq"
                        placeholder="Ask a debate question…"
                        intro="Ask me anything about debate technique, theory, or vocabulary. I run entirely on your device — and I'm small, so double-check anything that matters."
                        seedPrompts={[
                            "What is a kritik?",
                            "How does topicality work?",
                            "What is a permutation?",
                        ]}
                    />
                </section>
            </div>
        </div>
    );
}
