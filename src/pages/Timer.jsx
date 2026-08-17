/**
 * Round timer. Sequences and prep durations are carried over unchanged from the
 * previous site so nothing a debater relies on shifts.
 *
 * Time is measured against a `performance.now()` anchor rather than decremented
 * once per tick: a backgrounded tab throttles timers, and a clock that quietly
 * loses ten seconds during a 2NR is worse than no clock.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Chrome.jsx";

const CONFIG = {
    LD: {
        prep: 240,
        sequence: [
            { name: "1AC", time: 360 },
            { name: "CX by NEG", time: 180 },
            { name: "1NC", time: 420 },
            { name: "CX by AFF", time: 180 },
            { name: "1AR", time: 240 },
            { name: "2NR", time: 360 },
            { name: "2AR", time: 180 },
        ],
    },
    Policy: {
        prep: 480,
        sequence: [
            { name: "1AC", time: 480 },
            { name: "CX by 2N", time: 180 },
            { name: "1NC", time: 480 },
            { name: "CX by 1A", time: 180 },
            { name: "2AC", time: 480 },
            { name: "CX by 1N", time: 180 },
            { name: "2NC", time: 480 },
            { name: "CX by 2A", time: 180 },
            { name: "1NR", time: 300 },
            { name: "1AR", time: 300 },
            { name: "2NR", time: 300 },
            { name: "2AR", time: 300 },
        ],
    },
    PF: {
        prep: 180,
        sequence: [
            { name: "1st Speaker (Team A)", time: 240 },
            { name: "1st Speaker (Team B)", time: 240 },
            { name: "Crossfire", time: 180 },
            { name: "2nd Speaker (Team A)", time: 240 },
            { name: "2nd Speaker (Team B)", time: 240 },
            { name: "Crossfire", time: 180 },
            { name: "Summary (Team A)", time: 180 },
            { name: "Summary (Team B)", time: 180 },
            { name: "Grand Crossfire", time: 180 },
            { name: "Final Focus (Team A)", time: 120 },
            { name: "Final Focus (Team B)", time: 120 },
        ],
    },
};

const clock = (s) => {
    const neg = s < 0;
    const abs = Math.abs(Math.round(s));
    return `${neg ? "-" : ""}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

export default function Timer() {
    const [format, setFormat] = useState("LD");
    const [ldPrep, setLdPrep] = useState(240);
    const [stage, setStage] = useState(0);
    const [running, setRunning] = useState(false);
    const [remaining, setRemaining] = useState(CONFIG.LD.sequence[0].time);
    const [prep, setPrep] = useState({ aff: 240, neg: 240 });
    const [prepSide, setPrepSide] = useState(null);

    const anchor = useRef(null);
    const baseline = useRef(remaining);
    const prepAnchor = useRef(null);
    const prepBaseline = useRef(0);

    const cfg = CONFIG[format];
    const prepTotal = format === "LD" ? ldPrep : cfg.prep;
    const current = cfg.sequence[stage];

    const reset = useCallback((nextFormat = format, nextLdPrep = ldPrep) => {
        const c = CONFIG[nextFormat];
        const p = nextFormat === "LD" ? nextLdPrep : c.prep;
        setStage(0);
        setRunning(false);
        setPrepSide(null);
        setRemaining(c.sequence[0].time);
        baseline.current = c.sequence[0].time;
        anchor.current = null;
        setPrep({ aff: p, neg: p });
    }, [format, ldPrep]);

    // One loop drives both the speech clock and whichever prep clock is live.
    useEffect(() => {
        if (!running && !prepSide) return;
        let raf = 0;
        const tick = () => {
            const now = performance.now();
            if (running && anchor.current != null) {
                setRemaining(baseline.current - (now - anchor.current) / 1000);
            }
            if (prepSide && prepAnchor.current != null) {
                const left = Math.max(0, prepBaseline.current - (now - prepAnchor.current) / 1000);
                setPrep((p) => ({ ...p, [prepSide]: left }));
                if (left <= 0) setPrepSide(null);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [running, prepSide]);

    const toggleRun = () => {
        if (running) {
            baseline.current = remaining;
            anchor.current = null;
            setRunning(false);
        } else {
            baseline.current = remaining;
            anchor.current = performance.now();
            setPrepSide(null);
            setRunning(true);
        }
    };

    const goStage = (i) => {
        const idx = Math.max(0, Math.min(i, cfg.sequence.length - 1));
        setStage(idx);
        setRunning(false);
        anchor.current = null;
        baseline.current = cfg.sequence[idx].time;
        setRemaining(cfg.sequence[idx].time);
    };

    const togglePrep = (side) => {
        if (prepSide === side) {
            setPrepSide(null);
            return;
        }
        if (prep[side] <= 0) return;
        prepBaseline.current = prep[side];
        prepAnchor.current = performance.now();
        setRunning(false);
        anchor.current = null;
        baseline.current = remaining;
        setPrepSide(side);
    };

    const over = remaining < 0;
    const pct = Math.max(0, Math.min(1, remaining / current.time));

    return (
        <div className="page">
            <div className="wrap">
                <header className="page-head">
                    <p className="eyebrow">Round utility</p>
                    <h1 className="display">Round <em>Timer.</em></h1>
                    <p className="lede">
                        Official sequences for LD, Policy and Public Forum, with prep clocks that hold
                        their time across a paused tab.
                    </p>
                </header>

                <div className="timer-controls">
                    <div className="chips">
                        {Object.keys(CONFIG).map((f) => (
                            <button
                                key={f}
                                className={`chip${format === f ? " is-on" : ""}`}
                                onClick={() => { setFormat(f); reset(f, ldPrep); }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>

                    {format === "LD" && (
                        <div className="chips">
                            <span className="mono" style={{ color: "var(--ink-3)", alignSelf: "center" }}>Prep</span>
                            {[240, 300].map((s) => (
                                <button
                                    key={s}
                                    className={`chip${ldPrep === s ? " is-on" : ""}`}
                                    onClick={() => { setLdPrep(s); reset("LD", s); }}
                                >
                                    {s / 60}m
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="timer-main">
                    <p className="mono timer-stage">
                        {current.name} · {clock(current.time)}
                    </p>
                    <p className={`timer-clock${over ? " is-over" : ""}`}>{clock(remaining)}</p>
                    <div className="timer-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${pct})`, background: over ? "var(--neg)" : "var(--accent)" }} />
                    </div>

                    <div className="timer-buttons">
                        <button className="btn btn-ghost btn-sm" onClick={() => goStage(stage - 1)} disabled={stage === 0}>
                            Previous
                        </button>
                        <button className="btn" onClick={toggleRun}>
                            {running ? "Pause" : over ? "Resume" : "Start"}
                        </button>
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => goStage(stage + 1)}
                            disabled={stage === cfg.sequence.length - 1}
                        >
                            Next speech <Icon name="arrow" size={13} />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => reset()}>Reset round</button>
                    </div>
                </div>

                <div className="grid grid-2 prep-grid">
                    {["aff", "neg"].map((side) => (
                        <div className="prep-card" key={side}>
                            <p className="mono">{side.toUpperCase()} prep</p>
                            <p className={`prep-clock${prep[side] <= 0 ? " is-out" : ""}`}>{clock(prep[side])}</p>
                            <div className="prep-actions">
                                <button
                                    className="btn btn-sm"
                                    onClick={() => togglePrep(side)}
                                    disabled={prep[side] <= 0}
                                >
                                    {prepSide === side ? "Stop" : "Start"}
                                </button>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setPrep((p) => ({ ...p, [side]: prepTotal }))}
                                >
                                    Reset
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <section className="hub-cat">
                    <div className="hub-cat-head">
                        <h2>Round sequence</h2>
                        <span className="mono">{cfg.sequence.length} stages</span>
                    </div>
                    <ol className="sequence">
                        {cfg.sequence.map((s, i) => (
                            <li key={`${s.name}-${i}`}>
                                <button
                                    className={`sequence-row${i === stage ? " is-current" : ""}${i < stage ? " is-done" : ""}`}
                                    onClick={() => goStage(i)}
                                >
                                    <span className="mono sequence-num">{String(i + 1).padStart(2, "0")}</span>
                                    <span>{s.name}</span>
                                    <span className="mono">{clock(s.time)}</span>
                                </button>
                            </li>
                        ))}
                    </ol>
                </section>
            </div>
        </div>
    );
}
