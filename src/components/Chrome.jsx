/**
 * Site chrome: the masthead, the footer, and the small persistent affordances
 * (scroll progress, back-to-top, toasts).
 *
 * The masthead is a two-row rule-bound bar rather than a floating pill — it is
 * meant to read as the head of a document, with the section index sitting on
 * the second row the way a running header would.
 */

import { useEffect, useState } from "react";

const NAV = [
    { id: "home", label: "Index" },
    { id: "hub", label: "Resources" },
    { id: "lectures", label: "Lectures" },
    { id: "team", label: "Collective" },
    { id: "faq", label: "FAQ" },
];

const APPS = [
    { href: "/flow/", label: "Cascade", note: "Flowing app" },
    { href: "/tools/card-cutter/", label: "Card Cutter", note: "Cut evidence" },
    { href: "/tools/speed-trainer/", label: "Speed Trainer", note: "Spreading drills" },
    { href: "/tools/round-tracker/", label: "Round Tracker", note: "Your record" },
];

const UTILITIES = [
    { id: "timer", label: "Round Timer" },
    { id: "screw", label: "Screw Calculator" },
    { id: "tools", label: "Resolution AI" },
];

export function Masthead({ page, navigate, theme, onToggleTheme, onOpenPalette }) {
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 8);
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        setMenuOpen(false);
    }, [page]);

    return (
        <header className={`masthead no-print${scrolled ? " is-scrolled" : ""}`}>
            <div className="wrap masthead-row">
                <button className="wordmark" onClick={() => navigate("home")} aria-label="Debate 101 — home">
                    <img src="/assets/logo.PNG" alt="" width="26" height="26" />
                    <span>DEBATE<b>101</b></span>
                </button>

                <nav className="masthead-nav" aria-label="Primary">
                    {NAV.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => navigate(item.id)}
                            className={`navlink${page === item.id ? " is-current" : ""}`}
                            aria-current={page === item.id ? "page" : undefined}
                        >
                            {item.label}
                        </button>
                    ))}

                    <div className="menu">
                        <button className="navlink" aria-haspopup="true">Apps</button>
                        <div className="menu-panel">
                            {APPS.map((a) => (
                                <a key={a.href} href={a.href}>
                                    <span>{a.label}</span>
                                    <span className="menu-note">{a.note}</span>
                                </a>
                            ))}
                            <div className="menu-rule" />
                            {UTILITIES.map((u) => (
                                <button key={u.id} onClick={() => navigate(u.id)}>
                                    <span>{u.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="menu">
                        <button className="navlink" aria-haspopup="true">Social</button>
                        <div className="menu-panel">
                            <a href="https://discord.debate101.org" target="_blank" rel="noopener"><span>Discord</span></a>
                            <a href="https://instagram.debate101.org" target="_blank" rel="noopener"><span>Instagram</span></a>
                            <a href="https://youtube.debate101.org" target="_blank" rel="noopener"><span>YouTube</span></a>
                            <a href="https://github.com/GeoWizard4645/debate101" target="_blank" rel="noopener"><span>GitHub</span></a>
                        </div>
                    </div>
                </nav>

                <div className="masthead-actions">
                    <button className="icon-btn" onClick={onOpenPalette} aria-label="Search — press Command K" title="Search (⌘K)">
                        <Icon name="search" />
                        <kbd>⌘K</kbd>
                    </button>
                    <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle dark mode" title="Toggle theme (Shift D)">
                        <Icon name={theme === "dark" ? "sun" : "moon"} />
                    </button>
                    <a className="btn btn-sm btn-accent masthead-cta" href="/flow/">Open Cascade</a>
                    <button className="icon-btn menu-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-expanded={menuOpen}>
                        <Icon name={menuOpen ? "close" : "bars"} />
                    </button>
                </div>
            </div>

            <div className="wrap masthead-sub">
                <span className="mono">Debate 101 Collective</span>
                <span className="mono masthead-credits">
                    Vivaan S. · Max F. · Max M. · Arjun G.
                </span>
            </div>

            {menuOpen && (
                <div className="mobile-menu">
                    {NAV.map((i) => (
                        <button key={i.id} onClick={() => navigate(i.id)}>{i.label}</button>
                    ))}
                    <div className="menu-rule" />
                    {APPS.map((a) => <a key={a.href} href={a.href}>{a.label}</a>)}
                    <div className="menu-rule" />
                    {UTILITIES.map((u) => (
                        <button key={u.id} onClick={() => navigate(u.id)}>{u.label}</button>
                    ))}
                </div>
            )}
        </header>
    );
}

export function Footer({ navigate }) {
    return (
        <footer className="site-footer no-print">
            <div className="wrap">
                <div className="footer-grid">
                    <div>
                        <div className="wordmark" style={{ marginBottom: "1rem" }}>
                            <img src="/assets/logo.PNG" alt="" width="26" height="26" />
                            <span>DEBATE<b>101</b></span>
                        </div>
                        <p style={{ color: "var(--ink-2)", maxWidth: "26ch" }}>
                            An unincorporated non-profit collective building free, open-source tools
                            for competitive debate.
                        </p>
                    </div>
                    <div>
                        <p className="footer-head">Apps</p>
                        <ul>
                            <li><a href="/flow/">Cascade</a></li>
                            <li><a href="/flow/download.html">Cascade for desktop</a></li>
                            <li><a href="/tools/card-cutter/">Card Cutter</a></li>
                            <li><a href="/tools/speed-trainer/">Speed Trainer</a></li>
                            <li><a href="/tools/round-tracker/">Round Tracker</a></li>
                        </ul>
                    </div>
                    <div>
                        <p className="footer-head">Learn</p>
                        <ul>
                            {["hub", "lectures", "faq", "team"].map((id) => (
                                <li key={id}>
                                    <button onClick={() => navigate(id)}>
                                        {{ hub: "Resource Hub", lectures: "Lectures", faq: "FAQ & Mentor", team: "Our Team" }[id]}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <p className="footer-head">Community</p>
                        <ul>
                            <li><a href="https://discord.debate101.org" target="_blank" rel="noopener">Discord</a></li>
                            <li><a href="https://instagram.debate101.org" target="_blank" rel="noopener">Instagram</a></li>
                            <li><a href="https://youtube.debate101.org" target="_blank" rel="noopener">YouTube</a></li>
                            <li><a href="https://github.com/GeoWizard4645/debate101" target="_blank" rel="noopener">GitHub</a></li>
                        </ul>
                    </div>
                </div>

                <hr className="rule" style={{ marginBlock: "2.5rem 1.5rem" }} />

                <p className="footer-fine">
                    Cascade implements the <code>.ebb</code> file format from{" "}
                    <a href="https://github.com/shreerammodi/ebb" target="_blank" rel="noopener">ebb</a>{" "}
                    by Shreeram Modi, so flows move between the two apps without conversion. Cascade is an
                    independent Debate 101 project and is not affiliated with or endorsed by the ebb project.
                </p>
                <p className="footer-fine">
                    © {new Date().getFullYear()} Debate 101 Collective · Licensed under{" "}
                    <a href="/LICENSE" target="_blank" rel="noopener">D101-NC-OS-1.0</a>
                    {" "}(open source, non-commercial reuse) · If you want to support the work:{" "}
                    <a href="https://buymeacoffee.com/debate101" target="_blank" rel="noopener">buymeacoffee.com/debate101</a>
                </p>
            </div>
        </footer>
    );
}

export function ScrollProgress() {
    const [pct, setPct] = useState(0);
    useEffect(() => {
        let ticking = false;
        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                const max = document.documentElement.scrollHeight - window.innerHeight;
                setPct(max > 0 ? Math.min(1, window.scrollY / max) : 0);
            });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener("scroll", onScroll);
    }, []);
    return <div className="scroll-progress no-print" style={{ transform: `scaleX(${pct})` }} />;
}

export function BackToTop() {
    const [on, setOn] = useState(false);
    useEffect(() => {
        const onScroll = () => setOn(window.scrollY > 700);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);
    return (
        <button
            className={`to-top no-print${on ? " is-on" : ""}`}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Back to top"
            tabIndex={on ? 0 : -1}
        >
            <Icon name="up" />
        </button>
    );
}

export function Toasts({ items }) {
    return (
        <div className="toasts no-print" aria-live="polite">
            {items.map((t) => <div className="toast" key={t.id}>{t.message}</div>)}
        </div>
    );
}

/** Inline SVG icons — no icon font, no extra request. */
export function Icon({ name, size = 16 }) {
    const p = {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": true,
    };
    switch (name) {
        case "search": return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
        case "moon": return <svg {...p}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>;
        case "sun": return <svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
        case "up": return <svg {...p}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
        case "bars": return <svg {...p}><path d="M3 6h18M3 12h18M3 18h18" /></svg>;
        case "close": return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
        case "arrow": return <svg {...p}><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
        case "external": return <svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
        case "play": return <svg {...p}><path d="M6 4l14 8-14 8z" /></svg>;
        default: return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
    }
}
