/**
 * Cascade desktop — main process.
 *
 * This file's only job is to be a window around the exact same code that
 * runs at https://debate101.org/flow/. It owns no debate-flowing logic —
 * that all lives in /flow — it owns process lifecycle, file-system access
 * the browser sandbox can't grant (native Open/Save dialogs, .ebb double-
 * click, path allow-listing), and the native menu.
 *
 * Why a custom app:// protocol instead of file://: /flow is native ES
 * modules (`<script type="module">`, `import ... from "./x.js"`), and
 * Chromium enforces CORS for module imports. Modules loaded from file://
 * are treated as opaque origins and cross-module imports get blocked with a
 * CORS error — the app would load index.html and then fail silently on the
 * very first `import`. A registered custom scheme with `standard: true` and
 * `corsEnabled: true` behaves like a normal origin (https-like), so relative
 * module imports, fetch(), and the Google Fonts stylesheet all work exactly
 * as they do in a browser tab.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    dialog,
    shell,
    protocol,
    session,
} = require("electron");
const { buildMenu } = require("./menu.js");

/** The custom scheme the app is served over. See file header for why. */
const APP_SCHEME = "app";
/** Fixed placeholder host — the scheme is what matters, not the host. */
const APP_ORIGIN = `${APP_SCHEME}://cascade`;

/**
 * Scheme privileges must be registered before `app` is ready — this call has
 * to run at module load time, not inside `app.whenReady()`.
 * - standard: true    → parses like a normal URL (origin, relative paths)
 * - secure: true       → treated like https for mixed-content purposes
 * - supportFetchAPI    → the app uses fetch() for nothing load-bearing today,
 *                        but File System Access fallbacks and future features
 *                        may, and it costs nothing to allow it now
 * - corsEnabled: true   → required for ES module imports to succeed
 * - stream: true        → lets protocol.handle stream large responses
 */
protocol.registerSchemesAsPrivileged([
    {
        scheme: APP_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
            allowServiceWorkers: false,
        },
    },
]);

/**
 * Resolve the on-disk /flow directory for both run modes.
 * - Dev (`npm start` from /desktop, unpackaged): __dirname is .../desktop,
 *   so the sibling checked into git is ../flow.
 * - Packaged: electron-builder's `extraResources` (see package.json) copies
 *   the whole flow/ tree, unpacked, to the resources directory —
 *   Contents/Resources/flow on mac, resources/flow on Windows/Linux — which
 *   Electron always exposes as `process.resourcesPath`.
 */
function resolveFlowDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, "flow")
        : path.join(__dirname, "..", "flow");
}

const FLOW_DIR = resolveFlowDir();

/** Minimal extension -> MIME map. Deliberately explicit rather than relying
 * on Chromium's file-extension sniffing, so `.js` always resolves to a
 * JavaScript MIME type (required for `<script type="module">` to load) on
 * every platform, not just the ones whose sniffer happens to know it. */
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".webmanifest": "application/manifest+json",
};

function mimeFor(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serve /flow's files over app://. Every request's path is resolved against
 * FLOW_DIR and re-checked to still be inside it before reading, so a
 * crafted `app://cascade/../../etc/passwd`-style request 403s instead of
 * escaping the sandboxed directory.
 */
function registerAppProtocol() {
    protocol.handle(APP_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            let pathname = decodeURIComponent(url.pathname);
            if (pathname === "" || pathname === "/") pathname = "/index.html";
            const filePath = path.normalize(path.join(FLOW_DIR, pathname));
            const withinFlowDir =
                filePath === FLOW_DIR || filePath.startsWith(FLOW_DIR + path.sep);
            if (!withinFlowDir) {
                return new Response("Forbidden", { status: 403 });
            }
            const data = await fs.readFile(filePath);
            return new Response(data, {
                status: 200,
                headers: { "content-type": mimeFor(filePath) },
            });
        } catch (err) {
            return new Response(`Not found: ${err.message}`, { status: 404 });
        }
    });
}

/**
 * A strict Content-Security-Policy applied to every response. Google Fonts
 * is the one external host the app legitimately loads (see flow/index.html);
 * everything else is app: (this app's own served files) or inline styles,
 * which the app's toolbar/panel code sets directly on elements.
 */
function installCsp() {
    const csp = [
        "default-src 'self' app:",
        "script-src 'self' app:",
        "style-src 'self' app: 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' app: https://fonts.gstatic.com data:",
        "img-src 'self' app: data: blob:",
        "connect-src 'self' app:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                "Content-Security-Policy": [csp],
            },
        });
    });
}

// --- Single-instance lock -----------------------------------------------
// A debater double-clicking a second .ebb file should hand it to the
// already-open window, not spawn a second Cascade process fighting for the
// same autosave IndexedDB.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** A path queued because it arrived before the window existed / finished
 * loading (macOS can fire `open-file` before `app` is even ready). */
let pendingOpenPath = null;
/** Paths the user has actually chosen — via a dialog or an open-file event —
 * and is therefore allowed to read/write. See cascade:readFile/writeFile. */
const allowedPaths = new Set();
/** Set by the renderer via cascade:setDirty; drives the close-confirmation
 * flow and (on mac) the traffic-light "unsaved changes" dot. */
let isDirty = false;
/** When the user picks "Save" from the close-confirmation dialog, we ask the
 * renderer to save and wait for the next `setDirty(false)` before actually
 * closing, rather than guessing when an async save finished. */
let closeAfterNextClean = false;

function allow(filePath) {
    allowedPaths.add(path.resolve(filePath));
}

function isAllowed(filePath) {
    return allowedPaths.has(path.resolve(filePath));
}

/** Find a .ebb path in an argv array (Windows/Linux launch-by-double-click
 * and the second-instance handoff both deliver the file this way). */
function extractEbbPathFromArgv(argv) {
    return argv.find((arg) => !arg.startsWith("-") && arg.toLowerCase().endsWith(".ebb"));
}

/** Read a file and push it to the renderer as cascade:openPath, queuing if
 * the window isn't ready to receive it yet. */
async function deliverOpenPath(filePath) {
    const resolved = path.resolve(filePath);
    if (!mainWindow || mainWindow.webContents.isLoadingMainFrame()) {
        pendingOpenPath = resolved;
        return;
    }
    try {
        const text = await fs.readFile(resolved, "utf8");
        allow(resolved);
        mainWindow.webContents.send("cascade:openPath", { path: resolved, text });
    } catch (err) {
        dialog.showErrorBox("Couldn't open flow", `${resolved}\n\n${err.message}`);
    }
}

function flushPendingOpenPath() {
    if (pendingOpenPath) {
        const p = pendingOpenPath;
        pendingOpenPath = null;
        deliverOpenPath(p);
    }
}

// macOS delivers double-clicked/dropped-on-the-dock-icon files via this
// event, sometimes before `ready` fires — register it as early as possible
// (Electron's own recommendation), well before app.whenReady() below.
app.on("open-file", (event, filePath) => {
    event.preventDefault();
    deliverOpenPath(filePath);
});

app.on("second-instance", (_event, argv, workingDirectory) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const found = extractEbbPathFromArgv(argv);
    if (found) deliverOpenPath(path.resolve(workingDirectory, found));
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        show: false,
        // Matches app.css's dark-theme root background, so there is no white
        // flash between the native window appearing and the page painting.
        backgroundColor: "#0B1622",
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            // The preload script needs `require` (for contextBridge and to
            // read package.json for the app version) — sandbox:true would
            // deny that. The renderer itself never gets Node access; only
            // whatever preload explicitly puts on `window.cascadeDesktop` is
            // reachable from the page.
            sandbox: false,
        },
    });

    win.once("ready-to-show", () => win.show());

    win.webContents.on("did-finish-load", flushPendingOpenPath);

    // Block navigation to anything that isn't this app's own origin — a
    // stray link, a malformed import, or (in principle) a compromised
    // renderer should not be able to steer the window at an arbitrary URL.
    // External links are handed to the OS browser instead.
    win.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith(`${APP_ORIGIN}/`) || url === APP_ORIGIN) return;
        event.preventDefault();
        if (url.startsWith("http://") || url.startsWith("https://")) {
            shell.openExternal(url);
        }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    // Close confirmation: if the round has unsaved changes, ask before
    // closing rather than silently discarding a debater's flow.
    win.on("close", (event) => {
        if (!isDirty || closeAfterNextClean) return;
        event.preventDefault();
        const choice = dialog.showMessageBoxSync(win, {
            type: "warning",
            buttons: ["Save", "Don't Save", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            title: "Unsaved changes",
            message: "This flow has unsaved changes.",
            detail: "Do you want to save before closing?",
        });
        if (choice === 0) {
            // Ask the renderer to save; the actual close happens once it
            // reports back clean via cascade:setDirty(false), see the
            // ipcMain.on("cascade:setDirty", ...) handler below.
            closeAfterNextClean = true;
            win.webContents.send("cascade:menuCommand", "file.save");
        } else if (choice === 1) {
            isDirty = false;
            win.destroy();
        }
        // choice === 2 (Cancel), or the dialog being dismissed: do nothing.
    });

    win.on("closed", () => {
        if (win === mainWindow) mainWindow = null;
    });

    win.loadURL(`${APP_ORIGIN}/index.html`);
    return win;
}

app.whenReady().then(() => {
    registerAppProtocol();
    installCsp();

    Menu.setApplicationMenu(
        buildMenu((commandId) => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
            win?.webContents.send("cascade:menuCommand", commandId);
        }),
    );

    mainWindow = createWindow();

    // Windows/Linux deliver a double-clicked .ebb as a plain argv entry on
    // the very first launch (macOS uses the open-file event above instead).
    const initialPath = extractEbbPathFromArgv(process.argv);
    if (initialPath) deliverOpenPath(path.resolve(initialPath));

    app.on("activate", () => {
        // macOS convention: clicking the dock icon with no windows open
        // should reopen one rather than leaving the app inert.
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// --- IPC surface ----------------------------------------------------------
// See preload.js for the renderer-facing API these back, and
// flow/ARCHITECTURE.md for why the channel list is exactly this shape.
// Every file-touching handler re-validates against `allowedPaths` even
// though the renderer is the one that "chose" the path, because the
// renderer is untrusted from the main process's point of view — it only
// gets to read/write paths that came from a real native dialog or a real
// open-file/argv event, never an arbitrary string it made up.

ipcMain.handle("cascade:readFile", async (_event, filePath) => {
    if (typeof filePath !== "string" || !isAllowed(filePath)) {
        throw new Error("cascade:readFile — path not allowed");
    }
    return fs.readFile(filePath, "utf8");
});

ipcMain.handle("cascade:writeFile", async (_event, { path: filePath, text } = {}) => {
    if (typeof filePath !== "string" || !isAllowed(filePath)) {
        throw new Error("cascade:writeFile — path not allowed");
    }
    if (typeof text !== "string") {
        throw new Error("cascade:writeFile — text must be a string");
    }
    await fs.writeFile(filePath, text, "utf8");
    return true;
});

ipcMain.handle("cascade:showSaveDialog", async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const result = await dialog.showSaveDialog(win, {
        title: "Save flow",
        filters: [
            { name: "Debate flow", extensions: ["ebb"] },
            { name: "All files", extensions: ["*"] },
        ],
        ...options,
    });
    if (result.canceled || !result.filePath) return null;
    allow(result.filePath);
    return result.filePath;
});

ipcMain.handle("cascade:showOpenDialog", async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const result = await dialog.showOpenDialog(win, {
        title: "Open flow",
        properties: ["openFile"],
        filters: [
            { name: "Debate flow", extensions: ["ebb"] },
            { name: "Importable flows", extensions: ["ebb", "json", "csv", "tsv", "txt", "md", "docx", "xlsx"] },
            { name: "All files", extensions: ["*"] },
        ],
        ...options,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    result.filePaths.forEach(allow);
    return result.filePaths;
});

ipcMain.on("cascade:setDirty", (event, dirty) => {
    isDirty = Boolean(dirty);
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    // documentEdited puts the small "unsaved changes" dot in the mac traffic
    // light; it's a no-op (but harmless) on Windows/Linux.
    win?.setDocumentEdited?.(isDirty);
    if (!isDirty && closeAfterNextClean) {
        closeAfterNextClean = false;
        win?.destroy();
    }
});

// --- Auto-updater (intentionally off) --------------------------------------
// `electron-updater` would go here, e.g.:
//
//   const { autoUpdater } = require("electron-updater");
//   autoUpdater.checkForUpdatesAndNotify();
//
// It's not wired up because there is no code-signing certificate yet: an
// unsigned build can't be auto-updated safely (Squirrel/NSIS/appimage
// updaters all expect a signed, verifiable artifact, and shipping an
// updater that silently pulls & runs unsigned code defeats the point of
// having one). Revisit once mac/win signing identities exist — at that
// point this also needs a publish target (GitHub Releases is the natural
// one given the repo) in package.json's `build.publish`.
