/**
 * Cascade — command + keybinding registry.
 *
 * Every user-reachable action is a command with an id. The palette lists them,
 * the keymap binds chords to them, the desktop menu dispatches them, and a
 * feature module can add one without touching any of those three.
 *
 * Chord strings are canonical: modifiers in the fixed order Mod, Alt, Shift,
 * then the key, joined by "+". "Mod" is Cmd on macOS and Ctrl elsewhere, so a
 * binding is written once and reads correctly on both. Shift is expressed as an
 * explicit "Shift+" segment rather than by letter case, because a keymap a
 * debater edits by hand should not depend on capitalization.
 */

import { isMac } from "./dom.js";

/** @type {Map<string, {id, title, category, run, keys, when, hidden, icon}>} */
const commands = new Map();
/** chord -> commandId */
const bindings = new Map();
const listeners = new Set();

function notify() {
    for (const fn of listeners) {
        try {
            fn();
        } catch (err) {
            console.error("[registry] listener threw:", err);
        }
    }
}

/**
 * Register a command.
 * @param {object} cmd
 * @param {string} cmd.id            dotted id, e.g. "timer.startSpeech"
 * @param {string} cmd.title         palette label, e.g. "Start speech clock"
 * @param {string} [cmd.category]    palette grouping, e.g. "Timers"
 * @param {string[]} [cmd.keys]      default chords, e.g. ["Mod+Shift+T"]
 * @param {string} [cmd.icon]        single character or emoji shown in the palette
 * @param {() => any} cmd.run
 * @param {() => boolean} [cmd.when] availability predicate; false greys it out
 * @param {boolean} [cmd.hidden]     keep out of the palette (still dispatchable)
 */
export function register(cmd) {
    if (!cmd?.id || typeof cmd.run !== "function") {
        throw new Error("register() needs an id and a run()");
    }
    commands.set(cmd.id, { category: "General", keys: [], ...cmd });
    for (const chord of cmd.keys ?? []) {
        // A chord already claimed by another command keeps its first owner:
        // whoever registered first wins, and the collision is logged rather
        // than silently rebinding a key a debater has in their fingers.
        const canon = canonicalChord(chord);
        const existing = bindings.get(canon);
        if (existing && existing !== cmd.id) {
            console.warn(`[registry] ${canon} already bound to ${existing}; ignoring ${cmd.id}`);
            continue;
        }
        bindings.set(canon, cmd.id);
    }
    notify();
    return () => unregister(cmd.id);
}

/** Register many at once. */
export function registerAll(cmds) {
    const undos = cmds.map(register);
    return () => undos.forEach((fn) => fn());
}

export function unregister(id) {
    commands.delete(id);
    for (const [chord, cmdId] of [...bindings]) if (cmdId === id) bindings.delete(chord);
    notify();
}

export function get(id) {
    return commands.get(id);
}

/** All commands, palette-visible ones first, in registration order. */
export function list({ includeHidden = false } = {}) {
    return [...commands.values()].filter((c) => includeHidden || !c.hidden);
}

/** Run a command by id. Returns undefined when unknown or unavailable. */
export function run(id, ...args) {
    const cmd = commands.get(id);
    if (!cmd) return console.warn(`[registry] unknown command "${id}"`);
    if (cmd.when && !cmd.when()) return;
    try {
        return cmd.run(...args);
    } catch (err) {
        console.error(`[registry] "${id}" threw:`, err);
    }
}

/** Rebind a chord, dropping whatever held it. Pass null to clear. */
export function bind(chord, commandId) {
    const canon = canonicalChord(chord);
    if (commandId === null) bindings.delete(canon);
    else bindings.set(canon, commandId);
    notify();
}

/** The command id a chord runs, or undefined. */
export function lookup(chord) {
    return bindings.get(canonicalChord(chord));
}

/** Every chord bound to a command, in binding order. */
export function chordsFor(id) {
    return [...bindings].filter(([, cmdId]) => cmdId === id).map(([chord]) => chord);
}

export function allBindings() {
    return new Map(bindings);
}

/** Subscribe to registry changes (new commands, rebinds). */
export function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// --- Chords ------------------------------------------------------------------

const ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

/** Normalize "shift+mod+k" to "Mod+Shift+K". */
export function canonicalChord(chord) {
    const parts = String(chord).split("+").filter(Boolean);
    const key = parts.pop() ?? "";
    const mods = new Set(
        parts.map((p) => {
            const low = p.toLowerCase();
            if (low === "mod" || low === "cmd" || low === "meta" || low === "command") return "Mod";
            if (low === "ctrl" || low === "control") return "Ctrl";
            if (low === "alt" || low === "option" || low === "opt") return "Alt";
            if (low === "shift") return "Shift";
            return p;
        }),
    );
    const normKey = key.length === 1 ? key.toUpperCase() : key;
    return [...ORDER.filter((m) => mods.has(m)), normKey].join("+");
}

/** The canonical chord a KeyboardEvent represents. */
export function chordFromEvent(e) {
    const mods = [];
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const otherCtrl = isMac() ? e.ctrlKey : e.metaKey;
    if (mod) mods.push("Mod");
    if (otherCtrl) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    let key = e.key;
    if (key === " ") key = "Space";
    if (["Meta", "Control", "Alt", "Shift"].includes(key)) return null;
    // e.key already carries the shifted character on most layouts, so a chord
    // is keyed off e.code's letter for letters to keep Mod+Shift+K from
    // arriving as "Mod+Shift+K" on one layout and "Mod+Shift+ĸ" on another.
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (key.length === 1) key = key.toUpperCase();
    return [...mods, key].join("+");
}

/** Human-readable chord: "⌘⇧K" on Mac, "Ctrl+Shift+K" elsewhere. */
export function prettyChord(chord) {
    const canon = canonicalChord(chord);
    if (!isMac()) {
        return canon.replace(/^Mod/, "Ctrl").replace(/\+/g, "+");
    }
    const parts = canon.split("+");
    const key = parts.pop();
    const glyphs = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
    const named = {
        ArrowUp: "↑",
        ArrowDown: "↓",
        ArrowLeft: "←",
        ArrowRight: "→",
        Enter: "↩",
        Backspace: "⌫",
        Escape: "esc",
        Space: "space",
        Tab: "⇥",
    };
    return parts.map((p) => glyphs[p] ?? p).join("") + (named[key] ?? key);
}

export const commandsApi = {
    register,
    registerAll,
    unregister,
    get,
    list,
    run,
    bind,
    lookup,
    chordsFor,
    allBindings,
    onChange,
    canonicalChord,
    chordFromEvent,
    prettyChord,
};

export default commandsApi;
