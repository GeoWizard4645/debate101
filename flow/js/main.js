/**
 * Cascade — boot.
 *
 * Wires the shell, the store, the grid, and the feature modules together in the
 * one order that works: theme before paint, shell before anything asks for a
 * DOM node, store before the grid reads a round, features last so their
 * commands land in a registry the palette is already watching.
 *
 * Every feature is loaded through `optional()`. A flow editor is a thing a
 * debater opens ninety seconds before a round starts: a module that throws on
 * import must cost them that panel, not the round.
 */

import bus from "./bus.js";
import { $, el } from "./dom.js";
import registry from "./registry.js";

const VERSION = "1.0.0";

/** Import a module, or log and continue without it. */
async function optional(path, label) {
    try {
        return await import(path);
    } catch (err) {
        console.error(`[cascade] ${label} failed to load: ${describe(err)}`, err);
        failures.push({ label, err });
        return null;
    }
}

/** Run a module's init(), or log and continue. */
function start(mod, label) {
    if (!mod) return false;
    const init = mod.init ?? mod.default?.init;
    if (typeof init !== "function") return false;
    try {
        init();
        return true;
    } catch (err) {
        console.error(`[cascade] ${label} failed to start: ${describe(err)}`, err);
        failures.push({ label, err });
        return false;
    }
}

/**
 * A readable one-line form of a thrown value. A DOMException stringifies to
 * "[object DOMException]", which is exactly as useful as no message at all —
 * and those are the failures that only show up inside the desktop shell, where
 * there is no devtools window open to inspect the object.
 */
function describe(err) {
    if (!err) return String(err);
    const name = err.name ?? err.constructor?.name ?? "Error";
    const message = err.message ?? String(err);
    return err.stack ? `${name}: ${message}\n${err.stack}` : `${name}: ${message}`;
}

const failures = [];

async function boot() {
    // 1. Shell first. Everything below asks it for a mount point, a modal, or a
    //    toast, so a missing shell is the one failure Cascade cannot ride out.
    const uiMod = await optional("./ui.js", "shell");
    const ui = uiMod?.ui ?? uiMod?.default;
    if (!ui) {
        document.body.innerHTML =
            '<div style="font:16px/1.6 system-ui;padding:3rem;max-width:40rem;margin:auto">' +
            "<h1>Cascade could not start</h1><p>The app shell failed to load. " +
            'Try a hard refresh, or open <a href="https://debate101.org">debate101.org</a>.</p></div>';
        return;
    }
    ui.setTheme?.(ui.theme?.() ?? "dark");
    window.cascadeUI = ui;

    // 2. Store, then the two views that read it.
    const storeMod = await optional("./store.js", "store");
    const store = storeMod?.store ?? storeMod?.default;
    window.cascadeStore = store;

    // A round has to exist before anything reads one. The grid, the sidebar,
    // and every feature panel are written against a live round, and a debater
    // opening the app twenty seconds before a round starts should not meet a
    // stack of null checks that each module got subtly different. So the store
    // opens on a scratch round and the start screen sits on top of it: picking
    // New or opening a file replaces the scratch round before it is ever seen.
    if (store && !store.round) {
        try {
            await store.newRound?.({ event: "policy", firstSide: "aff" });
        } catch (err) {
            console.error("[cascade] could not open a starting round:", err);
        }
    }

    const gridMod = await optional("./grid.js", "grid");
    const sheetsMod = await optional("./sheets.js", "sheets");

    try {
        gridMod?.mountGrid?.($("#grid-host"));
    } catch (err) {
        console.error("[cascade] grid failed to mount:", err);
        failures.push({ label: "grid", err });
    }
    try {
        sheetsMod?.mountSheets?.($("#sidebar"));
    } catch (err) {
        console.error("[cascade] sidebar failed to mount:", err);
        failures.push({ label: "sheets", err });
    }

    // 3. Features. Order here is only the order their panels and toolbar
    //    buttons appear in, so it is the order a debater reaches for them.
    const features = [
        ["./timers.js", "Round Clock"],
        ["./links.js", "Links & dropped arguments"],
        ["./blocks.js", "Block library"],
        ["./voice.js", "Voice Flow"],
        ["./insights.js", "Analytics & evidence"],
        ["./exports.js", "Import & export"],
        ["./gitpush.js", "Push to Git"],
    ];
    for (const [path, label] of features) start(await optional(path, label), label);

    // 4. Palette last: it snapshots the registry's defaults before applying the
    //    debater's own keymap over them, and every command has to be in there
    //    by that point or a rebind would have nothing to rebind.
    const paletteMod = await optional("./palette.js", "Command palette");
    start(paletteMod, "Command palette");
    try {
        paletteMod?.applyStoredKeymap?.();
    } catch (err) {
        console.error("[cascade] keymap failed to apply:", err);
    }

    wireDesktop(store, ui);
    wireStartScreen(store, ui);
    wireTitle(store);
    registerCoreCommands(store, ui);

    if (failures.length) {
        ui.toast?.(
            `${failures.length} module${failures.length > 1 ? "s" : ""} failed to load — check the console`,
            { type: "warn", ms: 6000 },
        );
    }

    bus.emit("app:ready", { version: VERSION });
    document.documentElement.dataset.cascadeReady = "true";
    console.info(`Cascade ${VERSION} — debate101.org/flow`);
}

/**
 * The desktop bridge, when there is one. `window.cascadeDesktop` is injected by
 * the Electron preload; on the web it is simply absent and every path below
 * falls back to what the browser already gives us.
 */
function wireDesktop(store, ui) {
    const desktop = window.cascadeDesktop;
    document.documentElement.dataset.shell = desktop ? "desktop" : "web";
    if (!desktop) return;

    desktop.onOpenPath?.(async ({ path, text }) => {
        try {
            const file = new File([text], path.split(/[\\/]/).pop(), { type: "application/json" });
            await store?.openFile?.(file, { path });
        } catch (err) {
            ui.toast?.(`Could not open that flow: ${err.message}`, { type: "error", ms: 6000 });
        }
    });

    desktop.onMenuCommand?.((id) => registry.run(resolveCommand(id)));

    // The native window's close confirmation and its edited dot both read the
    // same bit the title bar does, so it is pushed rather than polled.
    bus.on("save:state", (state) => desktop.setDirty?.(!!state?.dirty));
}

/**
 * What the native menu calls a command, versus what the module that owns it
 * registered. The two are built independently — the menu ships inside the
 * Electron bundle and the modules ship inside the web app, and either can be
 * updated without the other — so a menu item naming an id that moved resolves
 * here rather than silently doing nothing.
 */
const MENU_ALIASES = {
    "file.new": "flow.new",
    "file.open": "flow.open",
    "file.openRecent": "app.startScreen",
    "file.save": "flow.save",
    "file.saveAs": "flow.saveAs",
    "file.pushGit": "flow.pushGit",
    "file.exportCiteSheet": "file.exportCites",
    "voice.panel": "voice.openPanel",
    "links.dropped": "links.openPanel",
    "insights.analytics": "insights.openAnalytics",
    "insights.evidence": "insights.openEvidence",
    "palette.cheatsheet": "help.open",
    "view.toggleSidebar": "sidebar.toggle",
    "view.togglePanel": "dock.toggle",
    "view.toggleDarkMode": "app.theme",
};

/**
 * The registered id a menu item means: itself if it exists, then its alias,
 * then any command sharing its last segment — which catches a module that
 * named its panel command `links.openDropped` where the menu says
 * `links.dropped`. Falls through to the original id so an unknown one still
 * logs the name the menu used.
 */
function resolveCommand(id) {
    const known = new Set(registry.list({ includeHidden: true }).map((c) => c.id));
    if (known.has(id)) return id;

    const alias = MENU_ALIASES[id];
    if (alias && known.has(alias)) return alias;

    const [namespace, verb] = String(alias ?? id).split(".");
    const sameNamespace = [...known].filter((c) => c.startsWith(`${namespace}.`));
    const lower = String(verb ?? "").toLowerCase();
    const match = sameNamespace.find((c) => c.split(".")[1]?.toLowerCase().includes(lower));
    return match ?? id;
}

/**
 * The topbar title and the browser tab. Both read the same three facts — the
 * file name, who is debating, and whether there are unsaved changes — so they
 * are written from one place rather than by whichever module happened to learn
 * about a change first.
 */
function wireTitle(store) {
    const titleHost = $("#topbar-title");
    const metaEl = $("#topbar-round-meta");
    let editing = false;

    const displayName = () => store.getDisplayName?.() ?? "Untitled round";

    const renderName = () => {
        if (!titleHost || editing) return;
        const round = store.round;
        if (!round) return;

        const sc = round.scouting ?? {};
        const name = displayName();
        const dirtyMark = store.dirty ? " •" : "";

        let nameEl = titleHost.querySelector(".topbar-round-name");
        if (!nameEl) {
            nameEl = el("span.topbar-round-name", {
                role: "button",
                tabindex: "0",
                title: "Click to rename this flow",
            });
            titleHost.prepend(nameEl);
        }
        nameEl.textContent = name + dirtyMark;
        nameEl.onclick = beginEdit;
        nameEl.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                beginEdit();
            }
        };

        if (metaEl) {
            metaEl.textContent = [
                round.event?.toUpperCase(),
                sc.round,
                sc.affSchool && sc.negSchool ? `${sc.affSchool} vs ${sc.negSchool}` : null,
                sc.judge ? `Judge: ${sc.judge}` : null,
            ]
                .filter(Boolean)
                .join(" · ");
        }
        document.title = `${name}${dirtyMark} — Cascade`;
    };

    const beginEdit = () => {
        if (editing || !titleHost) return;
        editing = true;
        const initial = displayName();
        const input = el("input.topbar-round-name-input", {
            type: "text",
            value: displayName(),
            "aria-label": "Flow title",
        });
        const existing = titleHost.querySelector(".topbar-round-name");
        existing?.replaceWith(input);
        queueMicrotask(() => {
            input.focus();
            input.select();
        });
        const finish = (save) => {
            if (!editing) return;
            editing = false;
            if (save) {
                const next = input.value.trim();
                if (next && next !== initial) store.renameFlow?.(next);
            }
            renderName();
        };
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
            }
        });
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("click", (e) => e.stopPropagation());
    };

    bus.on("round:change", renderName);
    bus.on("save:state", renderName);
    bus.on("file:opened", renderName);
    renderName();
}

/** Start screen: new / open / recents, and the hand-off into the editor. */
function wireStartScreen(store, ui) {
    if (!store) return;

    const el = ui.startScreenEl?.() ?? $("#start-screen");
    const pick = (sel) => (el ? el.querySelector(sel) : null);

    // The start screen draws both choices as segmented radio groups and keeps
    // a hidden input in sync with each. Read the hidden one first, then fall
    // back to whichever radio is checked — so a redesign that drops either
    // half still yields the debater's actual pick rather than the default.
    const root = el ?? document;
    const choice = (proxyId, radioName, fallback) =>
        root.querySelector(`#${proxyId}`)?.value ||
        root.querySelector(`input[name="${radioName}"]:checked`)?.value ||
        fallback;

    const readNewRoundOptions = () => ({
        event: choice("start-event", "start-event-radio", "policy"),
        firstSide: choice("start-first-side", "start-first-radio", "aff"),
    });

    pick("#start-new")?.addEventListener("click", async () => {
        await store.newRound?.(readNewRoundOptions());
        ui.hideStartScreen?.();
    });
    pick("#start-open")?.addEventListener("click", async () => {
        if (await store.open?.()) ui.hideStartScreen?.();
    });

    // A file arriving from anywhere — a picker, a drop, the desktop's
    // open-file — is the signal that the editor should be up. `round:change`
    // deliberately is not: the scratch round boot creates fires one, and so
    // does every keystroke once a round is open.
    bus.on("file:opened", () => ui.hideStartScreen?.());

    renderRecents(store, ui, pick("#start-recents"));
}

async function renderRecents(store, ui, host) {
    if (!host || !store?.recents) return;
    let recents = [];
    try {
        recents = (await store.recents()) ?? [];
    } catch (err) {
        console.error("[cascade] could not read recents:", err);
        return;
    }
    // The list is a <ul> in the shell, so every entry is wrapped in an <li> —
    // a bare button inside a list is invalid and screen readers announce the
    // count wrong.
    host.textContent = "";
    if (!recents.length) {
        const empty = document.createElement("li");
        empty.className = "start-recents-empty";
        empty.textContent = "Nothing yet — your last few rounds will show up here.";
        host.append(empty);
        return;
    }
    for (const item of recents) {
        const li = document.createElement("li");
        const row = document.createElement("button");
        row.type = "button";
        row.className = "start-recent";
        const name = document.createElement("span");
        name.className = "start-recent-name";
        name.textContent = item.name || item.tournament || "Untitled flow";
        const meta = document.createElement("span");
        meta.className = "start-recent-meta";
        meta.textContent = [item.event?.toUpperCase(), relativeTime(item.updatedAt)]
            .filter(Boolean)
            .join(" · ");
        row.append(name, meta);
        row.addEventListener("click", async () => {
            await store.restoreRecent?.(item.id);
            ui.hideStartScreen?.();
        });
        li.append(row);
        host.append(li);
    }
}

function relativeTime(ts) {
    if (!ts) return "";
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(ts).toLocaleDateString();
}

/**
 * Commands that belong to no feature: the document verbs and the escape hatch
 * back to the start screen.
 */
function registerCoreCommands(store, ui) {
    if (!store) return;
    registry.registerAll([
        // New and Open carry no chord on purpose. Mod+O and Mod+Shift+O insert
        // rows and Mod+Alt+N runs the neg prep clock — all three are things a
        // debater does mid-speech, and they outrank two actions taken between
        // rounds. Both reach the palette, the start screen, and the desktop
        // menu, which is where a debater actually looks for them.
        {
            id: "flow.new",
            title: "New flow",
            category: "File",
            run: () => store.newRound?.({ event: store.round?.event ?? "policy" }),
        },
        {
            id: "flow.open",
            title: "Open flow…",
            category: "File",
            run: () => store.open?.(),
        },
        {
            id: "flow.save",
            title: "Save",
            category: "File",
            keys: ["Mod+S"],
            run: async () => {
                const ok = await store.save?.();
                if (ok) ui.toast?.("Saved", { type: "success", ms: 1400 });
            },
        },
        {
            id: "flow.saveAs",
            title: "Save as…",
            category: "File",
            keys: ["Mod+Shift+S"],
            run: () => store.saveAs?.(),
        },
        {
            id: "edit.undo",
            title: "Undo",
            category: "Edit",
            keys: ["Mod+Z"],
            run: () => store.undo?.(),
        },
        {
            id: "edit.redo",
            title: "Redo",
            category: "Edit",
            keys: ["Mod+Shift+Z"],
            run: () => store.redo?.(),
        },
        {
            id: "app.startScreen",
            title: "Back to start screen",
            category: "File",
            run: () => ui.showStartScreen?.(),
        },
        {
            id: "app.theme",
            title: "Toggle light / dark theme",
            category: "View",
            // Not Mod+Shift+L: links.js binds that to cycling a link's kind,
            // and a chord a debater reaches for mid-round outranks a theme.
            keys: ["Mod+Alt+T"],
            run: () => ui.setTheme?.(ui.theme?.() === "dark" ? "light" : "dark"),
        },
        {
            id: "app.site",
            title: "Open debate101.org",
            category: "Help",
            run: () => window.open("https://debate101.org", "_blank", "noopener"),
        },
    ]);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
    boot();
}

export { VERSION };
