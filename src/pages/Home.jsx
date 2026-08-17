/**
 * The index page — reworked as a masthead + numbered dossier rather than a
 * marketing scroll. Every section carries an index number and a rule, so the
 * page reads top-to-bottom like a document with a table of contents.
 */

import { useEffect, useRef } from "react";
import { Icon } from "../components/Chrome.jsx";
import Reveal from "../components/Reveal.jsx";
import { optimized, onImageError } from "../lib/images.js";
import { useCountUp, useReveal, prefersReducedMotion } from "../lib/hooks.js";

/** Columns of light falling like a flow being written down the page. */
function FlowCanvas() {
    const ref = useRef(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas || prefersReducedMotion()) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let w = 0, h = 0, streaks = [], raf = 0, running = true;
        const COLS = 30;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const parent = canvas.parentElement;
            w = parent.clientWidth;
            h = parent.clientHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            streaks = Array.from({ length: COLS }, (_, i) => ({
                x: (i + 0.5) * (w / COLS),
                y: Math.random() * h,
                len: 50 + Math.random() * 190,
                speed: 0.2 + Math.random() * 0.85,
                alpha: 0.05 + Math.random() * 0.16,
            }));
        };

        const frame = () => {
            if (!running) return;
            ctx.clearRect(0, 0, w, h);
            const dark = document.documentElement.getAttribute("data-theme") === "dark";
            const rgb = dark ? "76, 155, 255" : "11, 99, 206";
            for (const s of streaks) {
                const grad = ctx.createLinearGradient(s.x, s.y - s.len, s.x, s.y);
                grad.addColorStop(0, `rgba(${rgb}, 0)`);
                grad.addColorStop(1, `rgba(${rgb}, ${s.alpha})`);
                ctx.strokeStyle = grad;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y - s.len);
                ctx.lineTo(s.x, s.y);
                ctx.stroke();
                s.y += s.speed;
                if (s.y - s.len > h) {
                    s.y = -Math.random() * 140;
                    s.len = 50 + Math.random() * 190;
                    s.speed = 0.2 + Math.random() * 0.85;
                }
            }
            raf = requestAnimationFrame(frame);
        };

        resize();
        frame();
        const onVis = () => {
            running = !document.hidden;
            if (running) frame();
            else cancelAnimationFrame(raf);
        };
        window.addEventListener("resize", resize);
        document.addEventListener("visibilitychange", onVis);
        return () => {
            running = false;
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", resize);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, []);

    return <canvas className="flow-canvas" ref={ref} aria-hidden="true" />;
}

function Section({ index, title, children, id }) {
    const ref = useReveal();
    return (
        <section className="section" id={id}>
            <div className="wrap">
                <div className="section-head reveal" ref={ref}>
                    <span className="section-index">{index}</span>
                    <span className="eyebrow">{title}</span>
                </div>
                {children}
            </div>
        </section>
    );
}

const CASCADE_FEATURES = [
    ["Round Clock", "Speech, prep and cross-ex clocks on official event times, counting over when a speech runs long. Ending a speech walks the grid to the next column on its own."],
    ["Dropped-argument radar", "Cascade watches every row across every column and tells you exactly what the other team never answered — with a one-key jump to each drop."],
    ["Voice Flow", "Assisted capture listens for the words that start a new argument — “next off”, “turn”, “extend” — and lays them down as rows while you keep typing tags."],
    ["Block library", "Type ;perm and press Tab. Your shells, frontlines and frameworks expand in place, shared across a whole team as one JSON file."],
    ["Round analytics", "Coverage by side, time against the limit, density per speech, and a printable post-round report you can hand a partner or a coach."],
    ["Evidence tracker", "Every card you mark becomes a cite entry with author, year and URL, exportable as a clean cite sheet."],
];

export default function Home({ content, navigate }) {
    const resourceCount = (content?.resources ?? []).reduce((a, c) => a + (c.resources?.length ?? 0), 0);
    const [count, countRef] = useCountUp(resourceCount);
    const heroRef = useReveal();

    return (
        <>
            <section className="hero">
                <FlowCanvas />
                <div className="wrap hero-inner reveal" ref={heroRef}>
                    <p className="eyebrow">Building the discourse of tomorrow</p>
                    <h1 className="display display-xl">
                        Reshaping <em>competitive</em> debate through open-source rigor.
                    </h1>
                    <p className="lede hero-lede">
                        Debate 101 is an unincorporated non-profit collective bridging the gap between
                        novice learners and elite competition through tools, community, and strategy.
                    </p>
                    <div className="hero-actions">
                        <a className="btn btn-accent" href="/flow/">
                            Open Cascade <Icon name="arrow" size={14} />
                        </a>
                        <button className="btn btn-ghost" onClick={() => navigate("hub")}>
                            Browse the Resource Hub
                        </button>
                        <a className="btn btn-ghost" href="https://discord.debate101.org" target="_blank" rel="noopener">
                            Join the Discord
                        </a>
                    </div>

                    <dl className="hero-stats" ref={countRef}>
                        <div><dt className="mono">Curated resources</dt><dd>{count || resourceCount}</dd></div>
                        <div><dt className="mono">Free apps</dt><dd>4</dd></div>
                        <div><dt className="mono">Events covered</dt><dd>LD · CX · PF · Parli</dd></div>
                        <div><dt className="mono">Cost, forever</dt><dd>$0</dd></div>
                    </dl>
                </div>
            </section>

            <div className="marquee no-print" aria-hidden="true">
                <div className="marquee-track mono">
                    {Array.from({ length: 2 }).flatMap((_, k) =>
                        ["Keyboard-first flowing", "Dropped-argument radar", ".ebb interoperable",
                         "Runs fully offline", "No account, no telemetry", "Open source",
                         "Verbatim .docx import", "On-device AI"].map((t) => (
                            <span key={`${k}-${t}`}>{t} <span style={{ opacity: 0.35 }}>／</span></span>
                        )))}
                </div>
            </div>

            <Section index="01" title="The flagship" id="cascade">
                <div className="split">
                    <div>
                        <h2 className="display">The flow <em>follows</em> your hands.</h2>
                        <p className="lede" style={{ marginTop: "1.25rem" }}>
                            Cascade is our keyboard-first flowing app for Lincoln–Douglas, Policy,
                            Public Forum and Parli. It runs in the browser and as a native desktop app,
                            works completely offline, and reads and writes <code>.ebb</code> files — so a
                            flow moves between Cascade and{" "}
                            <a className="ulink" href="https://github.com/shreerammodi/ebb" target="_blank" rel="noopener">ebb</a>{" "}
                            without conversion.
                        </p>
                        <p className="keys mono">
                            <kbd>Tab</kbd> answers an argument · <kbd>⌘L</kbd> links a response ·{" "}
                            <kbd>⌘⇧D</kbd> jumps to a drop
                        </p>
                        <div className="hero-actions" style={{ marginTop: "1.75rem" }}>
                            <a className="btn" href="/flow/">Open in the browser</a>
                            <a className="btn btn-ghost" href="/flow/download.html">Get the desktop app</a>
                        </div>
                    </div>

                    <ol className="feature-list">
                        {CASCADE_FEATURES.map(([title, body], i) => (
                            <Reveal as="li" key={title} delay={i * 60}>
                                <span className="feature-num mono">{String(i + 1).padStart(2, "0")}</span>
                                <div>
                                    <h3>{title}</h3>
                                    <p>{body}</p>
                                </div>
                            </Reveal>
                        ))}
                    </ol>
                </div>
            </Section>

            <Section index="02" title="Everything else we build">
                <div className="grid grid-3">
                    {[
                        { href: "/tools/card-cutter/", name: "Card Cutter", desc: "Paste an article, highlight and underline what you read, and get a properly cited card that pastes into a speech doc with its formatting intact." },
                        { href: "/tools/speed-trainer/", name: "Speed Trainer", desc: "A live words-per-minute meter with a clarity score that checks whether you are still comprehensible at speed. Five drills and a season-long record." },
                        { href: "/tools/round-tracker/", name: "Round Tracker", desc: "Log every round and get the numbers back: aff/neg split, speaks distribution, win rate by strategy, plus a judge book and a scouting book." },
                    ].map((t, i) => (
                        <Reveal as="a" className="card" key={t.href} href={t.href} delay={i * 70}>
                            <span className="section-index">{String(i + 1).padStart(2, "0")}</span>
                            <h3 className="card-title">{t.name}</h3>
                            <p className="card-desc">{t.desc}</p>
                            <span className="card-go mono">Open <Icon name="arrow" size={12} /></span>
                        </Reveal>
                    ))}
                </div>
            </Section>

            <Section index="03" title="The archive">
                <div className="split">
                    <div>
                        <h2 className="display">
                            The world's largest <em>debate resource hub.</em>
                        </h2>
                        <p className="lede" style={{ marginTop: "1.25rem" }}>
                            {resourceCount} vetted tools, databases, camps, think tanks, and leagues —
                            everything from Tabroom and openCaselist to the Congressional Research
                            Service and the Stanford Encyclopedia of Philosophy. Searchable, categorised,
                            and free.
                        </p>
                        <div className="hero-actions" style={{ marginTop: "1.75rem" }}>
                            <button className="btn" onClick={() => navigate("hub")}>Explore the collection</button>
                            <button className="btn btn-ghost" onClick={() => navigate("lectures")}>Watch the lectures</button>
                        </div>
                    </div>
                    <div className="cat-list">
                        {(content?.resources ?? []).slice(0, 12).map((c) => (
                            <button className="cat-row" key={c.title} onClick={() => navigate("hub")}>
                                <span>{c.title}</span>
                                <span className="mono">{c.resources.length}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </Section>

            <Section index="04" title="The collective">
                <div className="split">
                    <div>
                        <h2 className="display">Built by debaters, <em>mid-season.</em></h2>
                        <p className="lede" style={{ marginTop: "1.25rem" }}>
                            Everything here is made by high-school competitors who needed it themselves —
                            and released free, open source, with no account and no telemetry.
                        </p>
                        <div className="hero-actions" style={{ marginTop: "1.75rem" }}>
                            <button className="btn btn-ghost" onClick={() => navigate("team")}>Meet the team</button>
                        </div>
                    </div>
                    <div className="grid grid-2">
                        {(content?.team ?? []).slice(0, 4).map((m) => (
                            <div className="member-mini" key={m.name}>
                                <img src={optimized(m.image)} alt="" loading="lazy" decoding="async" onError={onImageError(m.image)} />
                                <div>
                                    <p className="member-name">{m.name}</p>
                                    <p className="mono member-role">{m.role}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Section>
        </>
    );
}
