/**
 * Cascade desktop — preload script.
 *
 * Runs in an isolated world with Node access, before the page's own scripts.
 * Its only job is to hand the renderer a small, explicit bridge object —
 * `window.cascadeDesktop` — and nothing else. flow/store.js and friends
 * feature-detect that global: when it's present they use native
 * dialogs/file IO over IPC, and when it's absent (the plain web app at
 * https://debate101.org/flow/) they fall back to the browser's File System
 * Access API / <input type=file> / download(). Neither shell has to know
 * about the other's existence beyond that one `if (window.cascadeDesktop)`
 * check — see flow/ARCHITECTURE.md's store.js section.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// package.json ships alongside this file in both dev and packaged builds
// (electron-builder's `files` list includes it — see desktop/package.json),
// so this is a reliable way to read the desktop shell's own version without
// IPC round-trip or a channel of its own; `app.getVersion()` isn't reachable
// from preload because the `app` module is main-process-only.
const { version } = require("./package.json");

/**
 * The exact IPC surface. Every channel here matches one described in
 * flow/ARCHITECTURE.md / desktop/main.js — nothing is exposed beyond what's
 * listed there, and nothing here reaches into Node or Electron internals
 * that the page could use to escape the sandboxed bridge.
 */
const cascadeDesktop = {
    /** "darwin" | "win32" | "linux" */
    platform: process.platform,
    /** The desktop shell's own version (desktop/package.json), for About /
     * diagnostics — distinct from the web app's own version, if any. */
    version,

    /**
     * Read a file's text. The path must be one the user already chose via
     * showOpenDialog or an open-file/argv event — main.js enforces this
     * with a path allow-list and rejects anything else.
     * @param {string} filePath
     * @returns {Promise<string>}
     */
    readFile: (filePath) => ipcRenderer.invoke("cascade:readFile", filePath),

    /**
     * Write text to a file. Same allow-list rule as readFile: the path must
     * have come from showSaveDialog, showOpenDialog, or an open-file event.
     * @param {string} filePath
     * @param {string} text
     * @returns {Promise<true>}
     */
    writeFile: (filePath, text) => ipcRenderer.invoke("cascade:writeFile", { path: filePath, text }),

    /**
     * Native "Save As" dialog. Resolves with the chosen path (now
     * allow-listed for writeFile) or null if the user cancelled.
     * @param {Electron.SaveDialogOptions} [options]
     * @returns {Promise<string|null>}
     */
    showSaveDialog: (options) => ipcRenderer.invoke("cascade:showSaveDialog", options),

    /**
     * Native "Open" dialog. Resolves with the chosen path(s) (now
     * allow-listed for readFile) or null if the user cancelled.
     * @param {Electron.OpenDialogOptions} [options]
     * @returns {Promise<string[]|null>}
     */
    showOpenDialog: (options) => ipcRenderer.invoke("cascade:showOpenDialog", options),

    /**
     * Tell the shell whether the round has unsaved changes. Drives the
     * macOS traffic-light "unsaved" dot (documentEdited) and the
     * save-before-close confirmation prompt.
     * @param {boolean} isDirty
     */
    setDirty: (isDirty) => ipcRenderer.send("cascade:setDirty", Boolean(isDirty)),

    /**
     * Fires when the shell has a flow file to open — a double-clicked .ebb,
     * a file dropped on the dock/taskbar icon, or a second launch handed
     * off to this instance. Payload is `{path, text}`; the shell already
     * read the file, so the renderer just has to parse and load it.
     * @param {(payload: {path: string, text: string}) => void} callback
     * @returns {() => void} unsubscribe
     */
    onOpenPath: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("cascade:openPath", listener);
        return () => ipcRenderer.removeListener("cascade:openPath", listener);
    },

    /**
     * Fires when the user picks a native menu item that maps to a
     * registry command (see desktop/menu.js). Payload is the command id
     * exactly as registered in flow/js/registry.js, e.g. "timer.startStop" —
     * the renderer just does `registry.run(commandId)`.
     * @param {(commandId: string) => void} callback
     * @returns {() => void} unsubscribe
     */
    onMenuCommand: (callback) => {
        const listener = (_event, commandId) => callback(commandId);
        ipcRenderer.on("cascade:menuCommand", listener);
        return () => ipcRenderer.removeListener("cascade:menuCommand", listener);
    },
};

contextBridge.exposeInMainWorld("cascadeDesktop", cascadeDesktop);
