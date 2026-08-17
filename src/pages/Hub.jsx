/**
 * The Resource Hub.
 *
 * The old hub was a stack of horizontal carousels, which hid most of the
 * collection behind a scroll gesture. With 180+ entries that no longer works,
 * so this is a filterable index: category chips, live search across title,
 * description and keywords, and a plain grid you can actually scan.
 */

import { useMemo, useState } from "react";
import { Icon } from "../components/Chrome.jsx";
import Reveal from "../components/Reveal.jsx";
import { useCountUp } from "../lib/hooks.js";

function match(resource, q) {
    if (!q) return true;
    const hay = `${resource.title} ${resource.desc} ${resource.keywords || ""}`.toLowerCase();
    return q.split(/\s+/).every((term) => hay.includes(term));
}

export default function Hub({ content }) {
    const categories = content?.resources ?? [];
    const [query, setQuery] = useState("");
    const [active, setActive] = useState("All");

    const total = categories.reduce((a, c) => a + c.resources.length, 0);
    const [count, countRef] = useCountUp(total);

    const q = query.trim().toLowerCase();

    const visible = useMemo(() => {
        return categories
            .filter((c) => active === "All" || c.title === active)
            .map((c) => ({ ...c, resources: c.resources.filter((r) => match(r, q)) }))
            .filter((c) => c.resources.length > 0);
    }, [categories, active, q]);

    const shown = visible.reduce((a, c) => a + c.resources.length, 0);

    return (
        <div className="page">
            <div className="wrap">
                <header className="page-head">
                    <p className="eyebrow">Universal repository</p>
                    <h1 className="display">
                        Global <em>Resource Hub.</em>
                    </h1>
                    <p className="lede">
                        Every tool, database, camp, league and think tank we actually use — vetted,
                        categorised, and free to browse.
                    </p>

                    <div className="hub-meta" ref={countRef}>
                        <span className="mono">
                            <b>{count || total}</b> resources · {categories.length} categories
                        </span>
                        <a className="mono ulink" href="https://discord.debate101.org" target="_blank" rel="noopener">
                            Recommend a resource <Icon name="external" size={11} />
                        </a>
                    </div>
                </header>

                <div className="hub-controls">
                    <div className="search-field">
                        <Icon name="search" size={15} />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search phil, camps, databases, tools…"
                            aria-label="Search resources"
                        />
                        {query && (
                            <button onClick={() => setQuery("")} aria-label="Clear search">
                                <Icon name="close" size={14} />
                            </button>
                        )}
                    </div>

                    <div className="chips" role="tablist" aria-label="Filter by category">
                        {["All", ...categories.map((c) => c.title)].map((label) => (
                            <button
                                key={label}
                                role="tab"
                                aria-selected={active === label}
                                className={`chip${active === label ? " is-on" : ""}`}
                                onClick={() => setActive(label)}
                            >
                                {label}
                                {label !== "All" && (
                                    <span className="chip-count">
                                        {categories.find((c) => c.title === label)?.resources.length}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {q && (
                        <p className="mono result-count">
                            {shown} result{shown === 1 ? "" : "s"} for “{query.trim()}”
                        </p>
                    )}
                </div>

                {visible.length === 0 && (
                    <p className="empty">
                        Nothing matches that. Try a broader term — or suggest it in the Discord.
                    </p>
                )}

                {visible.map((cat) => (
                    <section className="hub-cat" key={cat.title}>
                        <div className="hub-cat-head">
                            <h2>{cat.title}</h2>
                            <span className="mono">{cat.resources.length}</span>
                        </div>
                        <div className="grid grid-3">
                            {cat.resources.map((r, i) => {
                                const internal = r.link?.startsWith("#") || !/^https?:/.test(r.link || "");
                                return (
                                    <Reveal
                                        as="a"
                                        className="card res-card"
                                        key={`${cat.title}-${r.title}`}
                                        delay={Math.min(i, 8) * 40}
                                        href={r.link}
                                        target={internal ? "_self" : "_blank"}
                                        rel={internal ? undefined : "noopener"}
                                    >
                                        <span className={`tag${internal ? " tag-internal" : ""}`}>
                                            {internal ? "internal" : "external"}
                                        </span>
                                        <h3 className="card-title">{r.title}</h3>
                                        <p className="card-desc">{r.desc}</p>
                                        <span className="card-go mono">
                                            Access <Icon name={internal ? "arrow" : "external"} size={12} />
                                        </span>
                                    </Reveal>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
