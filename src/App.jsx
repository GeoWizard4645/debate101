/**
 * App shell: routing, theme, palette, and the global keyboard layer.
 */

import { useCallback, useEffect, useState } from "react";
import { Masthead, Footer, ScrollProgress, BackToTop, Toasts } from "./components/Chrome.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import { useContent, useHashRoute, useSpotlight, useTheme } from "./lib/hooks.js";
import { prefetchWhenIdle } from "./lib/modelPrefetch.js";

import Home from "./pages/Home.jsx";
import Hub from "./pages/Hub.jsx";
import Lectures from "./pages/Lectures.jsx";
import Team from "./pages/Team.jsx";
import Timer from "./pages/Timer.jsx";
import Screw from "./pages/Screw.jsx";
import ResolutionAI from "./pages/ResolutionAI.jsx";
import Faq from "./pages/Faq.jsx";

const TITLES = {
    home: "Debate 101 | Cascade Flowing App & Open Source Debate Tools",
    hub: "Global Debate Resource Hub | Debate 101",
    lectures: "Lecture Lab | Debate 101",
    team: "The Collective | Debate 101",
    timer: "Round Timer | Debate 101",
    screw: "Screw Calculator | Debate 101",
    tools: "Resolution AI | Debate 101",
    faq: "Debate FAQ — AFF, NEG, Kritiks, Theory | Debate 101",
};

export default function App() {
    const [page, navigate] = useHashRoute();
    const [theme, toggleTheme] = useTheme();
    const { data, error } = useContent();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [toasts, setToasts] = useState([]);
    useSpotlight();

    const toast = useCallback((message) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((t) => [...t, { id, message }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
    }, []);

    useEffect(() => {
        document.title = TITLES[page] ?? TITLES.home;
    }, [page]);

    // Warm the first slice of the model at idle, so a visitor who later opens
    // an AI tool is already most of the way there. Declines to run on metered
    // or slow connections and on low-memory devices — see modelPrefetch.js.
    useEffect(() => {
        prefetchWhenIdle("stage1", 3000);
    }, []);

    const onToggleTheme = useCallback(() => {
        toggleTheme();
        toast(theme === "dark" ? "Light mode" : "Dark mode");
    }, [toggleTheme, theme, toast]);

    // Global keyboard: ⌘K, /, ?, ⇧D, and `g` chords.
    useEffect(() => {
        let awaitingG = false;
        let chordTimer = null;

        const onKey = (e) => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
            const mod = e.metaKey || e.ctrlKey;

            if (mod && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen((v) => !v);
                return;
            }
            if (typing) return;

            if (awaitingG) {
                awaitingG = false;
                clearTimeout(chordTimer);
                const map = { h: "home", r: "hub", l: "lectures", t: "team", f: "faq" };
                const k = e.key.toLowerCase();
                if (k === "c") { window.location.href = "/flow/"; e.preventDefault(); return; }
                if (map[k]) { navigate(map[k]); e.preventDefault(); }
                return;
            }

            if (e.key === "g") {
                awaitingG = true;
                chordTimer = setTimeout(() => { awaitingG = false; }, 1200);
            } else if (e.key === "/") {
                e.preventDefault();
                setPaletteOpen(true);
            } else if (e.key === "D" && e.shiftKey) {
                e.preventDefault();
                onToggleTheme();
            } else if (e.key === "t") {
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [navigate, onToggleTheme]);

    const props = { content: data, navigate, toast };

    return (
        <>
            <ScrollProgress />
            <Masthead
                page={page}
                navigate={navigate}
                theme={theme}
                onToggleTheme={onToggleTheme}
                onOpenPalette={() => setPaletteOpen(true)}
            />

            <main id="main">
                {error && (
                    <div className="wrap section">
                        <p className="eyebrow">Content unavailable</p>
                        <h1 className="display">The site's content file could not load.</h1>
                        <p className="lede" style={{ marginTop: "1rem" }}>
                            Our apps are separate and still work:{" "}
                            <a href="/flow/">Cascade</a>, <a href="/tools/card-cutter/">Card Cutter</a>,{" "}
                            <a href="/tools/speed-trainer/">Speed Trainer</a>,{" "}
                            <a href="/tools/round-tracker/">Round Tracker</a>.
                        </p>
                    </div>
                )}

                {!error && page === "home" && <Home {...props} />}
                {!error && page === "hub" && <Hub {...props} />}
                {!error && page === "lectures" && <Lectures {...props} />}
                {!error && page === "team" && <Team {...props} />}
                {!error && page === "timer" && <Timer {...props} />}
                {!error && page === "screw" && <Screw {...props} />}
                {!error && page === "tools" && <ResolutionAI {...props} />}
                {!error && page === "faq" && <Faq {...props} />}
            </main>

            <Footer navigate={navigate} />
            <BackToTop />
            <Toasts items={toasts} />
            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                navigate={navigate}
                content={data}
                onToggleTheme={onToggleTheme}
            />
        </>
    );
}
