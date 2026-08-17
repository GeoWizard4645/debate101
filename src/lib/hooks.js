/**
 * Shared hooks: routing, content loading, theme, reveal-on-scroll.
 *
 * Routing is hash-based on purpose. Every existing link, bookmark, and the
 * sitemap all point at `debate101.org/#hub`-style URLs, and a static host with
 * no rewrite rules cannot serve `/hub` directly anyway. Keeping hashes means
 * nothing that already exists breaks.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const PAGES = ["home", "hub", "lectures", "team", "timer", "screw", "tools", "faq"];

/** The current page id from the URL hash, kept in sync with back/forward. */
export function useHashRoute() {
    const read = () => {
        const raw = (window.location.hash || "").replace(/^#/, "").split("?")[0];
        return PAGES.includes(raw) ? raw : "home";
    };
    const [page, setPage] = useState(read);

    useEffect(() => {
        const onHash = () => setPage(read());
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);

    const navigate = useCallback((next) => {
        if (!PAGES.includes(next)) return;
        if (read() === next) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        window.location.hash = next;
        window.scrollTo({ top: 0, behavior: "auto" });
    }, []);

    return [page, navigate];
}

/**
 * The site's content, fetched once from the same data/content.json the old
 * site used. Kept as a fetch rather than an import so the file stays editable
 * without a rebuild — the whole point of it living in data/.
 */
export function useContent() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let live = true;
        fetch("/data/content.json", { cache: "no-cache" })
            .then((r) => {
                if (!r.ok) throw new Error(`content.json: HTTP ${r.status}`);
                return r.json();
            })
            .then((json) => live && setData(json))
            .catch((e) => live && setError(e));
        return () => {
            live = false;
        };
    }, []);

    return { data, error };
}

export function useTheme() {
    const [theme, setThemeState] = useState(
        () => document.documentElement.getAttribute("data-theme") || "light",
    );

    const setTheme = useCallback((next) => {
        document.documentElement.setAttribute("data-theme", next);
        try {
            localStorage.setItem("d1.theme", next);
        } catch (e) {
            /* private mode */
        }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", next === "dark" ? "#0a0e14" : "#051C2C");
        setThemeState(next);
    }, []);

    const toggle = useCallback(() => {
        const next = (document.documentElement.getAttribute("data-theme") === "dark") ? "light" : "dark";
        // One clean cross-fade instead of dozens of property transitions racing.
        if (document.startViewTransition && !prefersReducedMotion()) {
            const t = document.startViewTransition(() => setTheme(next));
            t.finished?.catch(() => {});
            t.ready?.catch(() => {});
            t.updateCallbackDone?.catch(() => {});
        } else {
            setTheme(next);
        }
    }, [setTheme]);

    return [theme, toggle];
}

export function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Adds `.in` to the element once it scrolls into view. Returns a ref.
 * `delay` staggers a row of siblings without any per-item bookkeeping.
 */
export function useReveal(delay = 0) {
    const ref = useRef(null);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
            node.classList.add("in");
            return;
        }
        node.style.setProperty("--delay", `${delay}ms`);
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    e.target.classList.add("in");
                    io.unobserve(e.target);
                }
            },
            { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
        );
        io.observe(node);
        return () => io.disconnect();
    }, [delay]);

    return ref;
}

/** Cursor-tracked spotlight coordinates for `.card`. */
export function useSpotlight() {
    useEffect(() => {
        const onMove = (e) => {
            const card = e.target.closest?.(".card");
            if (!card) return;
            const r = card.getBoundingClientRect();
            card.style.setProperty("--mx", `${e.clientX - r.left}px`);
            card.style.setProperty("--my", `${e.clientY - r.top}px`);
        };
        document.addEventListener("pointermove", onMove, { passive: true });
        return () => document.removeEventListener("pointermove", onMove);
    }, []);
}

/** Count up to a number once it is on screen, landing exactly on it. */
export function useCountUp(target, duration = 900) {
    const ref = useRef(null);
    const [value, setValue] = useState(0);

    useEffect(() => {
        if (!target) return;
        const node = ref.current;
        if (!node || prefersReducedMotion() || !("IntersectionObserver" in window)) {
            setValue(target);
            return;
        }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            setValue(target);
        };
        const io = new IntersectionObserver(
            (entries) => {
                if (!entries[0].isIntersecting) return;
                io.disconnect();
                const t0 = performance.now();
                const step = (now) => {
                    if (done) return;
                    const p = Math.min(1, (now - t0) / duration);
                    setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
                    if (p < 1) requestAnimationFrame(step);
                    else finish();
                };
                requestAnimationFrame(step);
                // rAF stops in a background tab; a half-finished count is a
                // wrong number presenting itself as the real one.
                setTimeout(finish, duration + 500);
            },
            { threshold: 0.4 },
        );
        io.observe(node);
        return () => io.disconnect();
    }, [target, duration]);

    return [value, ref];
}
