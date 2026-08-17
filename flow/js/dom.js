/**
 * Cascade — DOM helpers. No framework: a flow editor is a grid of text and a
 * few panels, and a build step would put a compiler between a debater and a
 * bug fix twenty minutes before a round.
 */

/**
 * el("div.foo#bar", { attrs }, ...children)
 *
 * The props argument is optional in the middle. `el("p", "Type ", el("kbd"))`
 * has to mean a paragraph with two children, not a paragraph whose attributes
 * are the character indices of the string "Type " — which is exactly what a
 * blind `Object.entries(props)` produced, and it threw
 * `InvalidCharacterError: '0' is not a valid attribute name` from deep inside
 * an unrelated panel. Anything that is not a plain object is a child.
 */
const isPropsBag = (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(typeof Node !== "undefined" && value instanceof Node);

export function el(spec, props, ...children) {
    if (!isPropsBag(props)) {
        if (props !== undefined) children.unshift(props);
        props = null;
    }
    const [head, ...classes] = String(spec).split(".");
    const [tag, id] = head.split("#");
    const node = document.createElement(tag || "div");
    if (id) node.id = id;
    if (classes.length) node.className = classes.join(" ");
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === "class" || k === "className") {
                node.className = [node.className, v].filter(Boolean).join(" ");
            } else if (k === "style" && typeof v === "object") {
                Object.assign(node.style, v);
            } else if (k === "dataset" && typeof v === "object") {
                Object.assign(node.dataset, v);
            } else if (k === "html") {
                node.innerHTML = v;
            } else if (k === "text") {
                node.textContent = v;
            } else if (k.startsWith("on") && typeof v === "function") {
                node.addEventListener(k.slice(2).toLowerCase(), v);
            } else if (v === true) {
                node.setAttribute(k, "");
            } else {
                node.setAttribute(k, v);
            }
        }
    }
    append(node, children);
    return node;
}

function append(node, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Remove every child of a node. */
export function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
}

/** Escape text for interpolation into an HTML string. */
export function esc(text) {
    return String(text ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

/** mm:ss, or h:mm:ss past an hour. Negative renders with a leading minus. */
export function fmtClock(totalSeconds) {
    const neg = totalSeconds < 0;
    const s = Math.floor(Math.abs(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${neg ? "-" : ""}${h ? `${h}:${pad(m)}` : m}:${pad(sec)}`;
}

/** Trailing-edge debounce. */
export function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    wrapped.flush = (...args) => {
        clearTimeout(t);
        fn(...args);
    };
    return wrapped;
}

/** Download a Blob or string under a filename, browser-side. */
export function download(filename, data, mime = "application/octet-stream") {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** True when the platform modifier (Cmd on Mac, Ctrl elsewhere) is held. */
export const isMac = () =>
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = (e) => (isMac() ? e.metaKey : e.ctrlKey);
export const MOD_LABEL = isMac() ? "⌘" : "Ctrl";
