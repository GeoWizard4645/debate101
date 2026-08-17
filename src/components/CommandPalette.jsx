/**
 * ⌘K command palette.
 *
 * The index is assembled from the site's own content, so a resource added to
 * data/content.json becomes searchable here without touching this file.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Chrome.jsx";

const PAGE_ITEMS = [
    { label: "Index", sub: "Home", page: "home" },
    { label: "Resource Hub", sub: "Curated debate tools", page: "hub" },
    { label: "Lectures", sub: "Video archive by argument style", page: "lectures" },
    { label: "The Collective", sub: "Founders and collaborators", page: "team" },
    { label: "Round Timer", sub: "LD, Policy and PF presets", page: "timer" },
    { label: "Screw Calculator", sub: "Break / bubble-round estimator", page: "screw" },
    { label: "Resolution AI", sub: "Break down a resolution on-device", page: "tools" },
    { label: "FAQ & Mentor", sub: "Glossary and Q&A", page: "faq" },
];

const APP_ITEMS = [
    { label: "Cascade", sub: "Our flowing app — web & desktop", href: "/flow/" },
    { label: "Cascade for desktop", sub: "macOS, Windows, Linux", href: "/flow/download.html" },
    { label: "Card Cutter", sub: "Cut and format evidence", href: "/tools/card-cutter/" },
    { label: "Speed Trainer", sub: "Spreading practice with a WPM meter", href: "/tools/speed-trainer/" },
    { label: "Round Tracker", sub: "Record, judge book, scouting book", href: "/tools/round-tracker/" },
];

const LINK_ITEMS = [
    { label: "Discord", sub: "discord.debate101.org", href: "https://discord.debate101.org" },
    { label: "Instagram", sub: "instagram.debate101.org", href: "https://instagram.debate101.org" },
    { label: "YouTube", sub: "youtube.debate101.org", href: "https://youtube.debate101.org" },
    { label: "GitHub", sub: "Source for everything we build", href: "https://github.com/GeoWizard4645/debate101" },
];

/** Subsequence scorer with prefix, substring, and word-boundary bonuses. */
function score(query, text) {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = (text || "").toLowerCase();
    if (!t) return -1;
    if (t.startsWith(q)) return 1000 - t.length;
    const direct = t.indexOf(q);
    if (direct >= 0) return 600 - direct - t.length * 0.1;
    let qi = 0, s = 0, streak = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) {
            streak += 1;
            s += 8 + streak * 3 + (i === 0 || /[\s\-—·&/]/.test(t[i - 1]) ? 12 : 0);
            qi += 1;
        } else streak = 0;
    }
    return qi === q.length ? s : -1;
}

function Highlight({ text, query }) {
    if (!query) return <>{text}</>;
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, i)}
            <mark>{text.slice(i, i + query.length)}</mark>
            {text.slice(i + query.length)}
        </>
    );
}

export default function CommandPalette({ open, onClose, navigate, content, onToggleTheme }) {
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const items = useMemo(() => {
        const out = [];
        PAGE_ITEMS.forEach((i) => out.push({ ...i, group: "Pages" }));
        APP_ITEMS.forEach((i) => out.push({ ...i, group: "Apps" }));

        (content?.resources ?? []).forEach((cat) => {
            (cat.resources ?? []).forEach((r) => {
                out.push({
                    label: r.title,
                    sub: cat.title,
                    keywords: r.keywords || "",
                    href: r.link?.startsWith("#") ? null : r.link,
                    page: r.link?.startsWith("#") ? r.link.slice(1) : null,
                    group: "Resources",
                });
            });
        });

        (content?.lectures ?? []).forEach((cat) => {
            (cat.lectures ?? cat.resources ?? []).forEach((l) => {
                out.push({ label: l.title, sub: cat.title, href: l.link || null, group: "Lectures" });
            });
        });

        LINK_ITEMS.forEach((i) => out.push({ ...i, group: "Community" }));
        out.push({ label: "Toggle dark mode", sub: "Switch the whole site", group: "Actions", run: onToggleTheme });
        return out;
    }, [content, onToggleTheme]);

    const results = useMemo(() => {
        const q = query.trim();
        return items
            .map((item) => ({
                item,
                s: Math.max(
                    score(q, item.label),
                    score(q, item.sub) * 0.6,
                    score(q, item.keywords || "") * 0.4,
                ),
            }))
            .filter((r) => (q ? r.s > 0 : true))
            .sort((a, b) => b.s - a.s)
            .slice(0, q ? 40 : 14)
            .map((r) => r.item);
    }, [items, query]);

    useEffect(() => {
        setIndex(0);
    }, [query]);

    useEffect(() => {
        if (open) {
            setQuery("");
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [open]);

    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }, [index, results]);

    if (!open) return null;

    const run = (item) => {
        if (!item) return;
        onClose();
        if (item.run) return item.run();
        if (item.page) return navigate(item.page);
        if (item.href) window.open(item.href, item.href.startsWith("http") ? "_blank" : "_self");
    };

    const onKeyDown = (e) => {
        if (e.key === "ArrowDown") { setIndex((i) => (i + 1) % Math.max(results.length, 1)); e.preventDefault(); }
        else if (e.key === "ArrowUp") { setIndex((i) => (i - 1 + results.length) % Math.max(results.length, 1)); e.preventDefault(); }
        else if (e.key === "Enter") { run(results[index]); e.preventDefault(); }
        else if (e.key === "Escape") { onClose(); e.preventDefault(); }
    };

    let lastGroup = null;

    return (
        <div className="palette-scrim no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="palette" role="dialog" aria-modal="true" aria-label="Search Debate 101">
                <input
                    ref={inputRef}
                    className="palette-input"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search pages, apps, resources…"
                    aria-label="Search"
                    autoComplete="off"
                    spellCheck="false"
                />
                <div className="palette-list" ref={listRef} role="listbox">
                    {results.length === 0 && (
                        <p className="palette-empty">Nothing matches “{query}”.</p>
                    )}
                    {results.map((item, i) => {
                        const header = item.group !== lastGroup ? item.group : null;
                        lastGroup = item.group;
                        return (
                            <div key={`${item.group}-${item.label}-${i}`}>
                                {header && <div className="palette-group">{header}</div>}
                                <div
                                    role="option"
                                    aria-selected={i === index}
                                    className="palette-item"
                                    onMouseMove={() => setIndex(i)}
                                    onClick={() => run(item)}
                                >
                                    <span className="palette-label"><Highlight text={item.label} query={query.trim()} /></span>
                                    <span className="palette-sub">{item.sub}</span>
                                    {item.href?.startsWith("http") && <Icon name="external" size={12} />}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="palette-foot mono">
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> open</span>
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>
        </div>
    );
}
