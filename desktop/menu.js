/**
 * Cascade desktop — native application menu.
 *
 * Every command a debater can reach lives in flow/js/registry.js's command
 * map (that's the whole point of the registry: the palette, the keymap, and
 * this menu all point at the same ids instead of three copies of the same
 * logic). So almost every item here does exactly one thing: send the
 * matching registry command id to the focused window over
 * "cascade:menuCommand" and let the page's own `registry.run(id)` do the
 * work — this file has no idea what "start the speech timer" actually does,
 * and it shouldn't.
 *
 * A few items are deliberately native instead (role: "cut"/"zoomIn"/
 * "toggleDevTools"/etc.) because they operate on the BrowserWindow/
 * webContents directly and gain nothing from a round-trip into the page.
 *
 * Accelerators: Electron consumes a registered accelerator at the native
 * menu layer — if a key combo has one here, the keydown never reaches the
 * web page. That means an accelerator here must NOT collide with a chord
 * the web app's own registry (flow/js/palette.js) already owns, or that
 * chord would silently stop working while a debater is mid-round. Chords
 * are only set here when flow/ARCHITECTURE.md documents them explicitly, or
 * for OS-native concerns (zoom, devtools, window management) the web app
 * has no chord for in the first place. Everything else is reachable by
 * mouse only — the shortcut still exists, just owned by the page.
 */

"use strict";

const { app, shell, dialog } = require("electron");

const isMac = process.platform === "darwin";

/**
 * Build the application menu.
 * @param {(commandId: string) => void} sendCommand
 *   Dispatches `cascade:menuCommand` with a registry command id to the
 *   focused (or main) window. Owned by main.js, which knows about windows;
 *   this module deliberately doesn't import BrowserWindow at all.
 * @returns {Electron.Menu}
 */
function buildMenu(sendCommand) {
    const { Menu } = require("electron");

    if (isMac) {
        app.setAboutPanelOptions({
            applicationName: "Cascade",
            applicationVersion: app.getVersion(),
            copyright: "Copyright (c) Debate 101 — flow format compatible with ebb v3",
        });
    }

    const cmd = (id) => () => sendCommand(id);

    const template = [
        // macOS app menu (About/Services/Hide/Quit) — role: "appMenu" builds
        // the standard set with the app's own name filled in automatically.
        ...(isMac ? [{ role: "appMenu" }] : []),

        {
            label: "File",
            submenu: [
                { label: "New Flow", accelerator: "CmdOrCtrl+N", click: cmd("file.new") },
                { label: "Open…", accelerator: "CmdOrCtrl+O", click: cmd("file.open") },
                // The renderer owns the actual recent-files list (it lives in
                // its autosave IndexedDB, see store.js's recents()) — this
                // just asks it to show that list rather than duplicating it
                // here from the main process.
                { label: "Open Recent", click: cmd("file.openRecent") },
                { type: "separator" },
                { label: "Save", accelerator: "CmdOrCtrl+S", click: cmd("file.save") },
                { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: cmd("file.saveAs") },
                { label: "Push to Git…", accelerator: "CmdOrCtrl+Shift+G", click: cmd("flow.pushGit") },
                // Matches flow/js/exports.js's Mod+Shift+I import chord exactly.
                { label: "Import…", accelerator: "CmdOrCtrl+Shift+I", click: cmd("file.import") },
                {
                    label: "Export",
                    submenu: [
                        { label: "Flow (.ebb)", click: cmd("file.exportEbb") },
                        { label: ".ebb (strict / interop)", click: cmd("file.exportEbbStrict") },
                        { label: "CSV…", click: cmd("file.exportCsv") },
                        { label: "Markdown", click: cmd("file.exportMarkdown") },
                        { label: "Text", click: cmd("file.exportText") },
                        { label: "Cite Sheet", click: cmd("file.exportCiteSheet") },
                    ],
                },
                { type: "separator" },
                // No accelerator: CmdOrCtrl+P is already the sheet
                // quick-switcher (flow's palette.js) — a native Print
                // accelerator here would swallow that keystroke before the
                // page ever saw it.
                { label: "Print…", click: cmd("file.print") },
                { type: "separator" },
                { role: "close", label: "Close Window" },
            ],
        },

        {
            label: "Edit",
            submenu: [
                // Undo/redo go through the round's own 200-entry history
                // stack (store.js), not the native text-field undo role, so
                // they're dispatched as commands like everything else.
                { label: "Undo", accelerator: "CmdOrCtrl+Z", click: cmd("edit.undo") },
                { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: cmd("edit.redo") },
                { type: "separator" },
                // Native roles: these fire a real clipboard event on
                // whatever's focused, which is exactly what lets grid.js's
                // own copy/paste-as-TSV handling intercept it.
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectAll" },
                { type: "separator" },
                { label: "Find…", accelerator: "CmdOrCtrl+F", click: cmd("grid.find") },
            ],
        },

        {
            label: "Flow",
            submenu: [
                { label: "New Aff Sheet", click: cmd("sheet.newAff") },
                { label: "New Neg Sheet", click: cmd("sheet.newNeg") },
                { label: "Rename Sheet…", click: cmd("sheet.rename") },
                { type: "separator" },
                { label: "Next Sheet", accelerator: "CmdOrCtrl+]", click: cmd("sheet.next") },
                { label: "Previous Sheet", accelerator: "CmdOrCtrl+[", click: cmd("sheet.prev") },
                { type: "separator" },
                { label: "Delete Sheet", click: cmd("sheet.delete") },
            ],
        },

        {
            label: "Timer",
            submenu: [
                {
                    label: "Start / Stop",
                    accelerator: "CmdOrCtrl+Shift+Space",
                    click: cmd("timer.startStop"),
                },
                {
                    label: "Next Speech",
                    accelerator: "CmdOrCtrl+Shift+Right",
                    click: cmd("timer.next"),
                },
                { label: "Reset", click: cmd("timer.reset") },
                { type: "separator" },
                { label: "Aff Prep", accelerator: "CmdOrCtrl+Shift+A", click: cmd("timer.prepAff") },
                { label: "Neg Prep", accelerator: "CmdOrCtrl+Shift+N", click: cmd("timer.prepNeg") },
                { type: "separator" },
                { label: "Mute", type: "checkbox", click: cmd("timer.mute") },
            ],
        },

        {
            label: "Tools",
            submenu: [
                { label: "Block Library…", accelerator: "CmdOrCtrl+Shift+B", click: cmd("blocks.picker") },
                { label: "Voice Flow", click: cmd("voice.panel") },
                { label: "Dropped Arguments", click: cmd("links.dropped") },
                { label: "Analytics", click: cmd("insights.analytics") },
                { label: "Evidence", click: cmd("insights.evidence") },
                { type: "separator" },
                { label: "Command Palette…", accelerator: "CmdOrCtrl+Shift+P", click: cmd("palette.open") },
            ],
        },

        {
            label: "View",
            submenu: [
                { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: cmd("view.toggleSidebar") },
                { label: "Toggle Panel", accelerator: "CmdOrCtrl+Shift+\\", click: cmd("view.togglePanel") },
                { type: "separator" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { role: "resetZoom" },
                { type: "separator" },
                { label: "Toggle Dark Mode", click: cmd("view.toggleDarkMode") },
                { type: "separator" },
                { role: "togglefullscreen", label: "Full Screen" },
                { role: "toggleDevTools" },
            ],
        },

        { role: "windowMenu" },

        {
            role: "help",
            submenu: [
                // No accelerator: "?" is a bare, unmodified key. flow's
                // palette.js only treats it as "open the cheatsheet" when
                // the grid isn't in cell-edit mode; a native accelerator
                // would intercept every "?" a debater types into a cell,
                // including mid-round.
                { label: "Keyboard Shortcuts", click: cmd("palette.cheatsheet") },
                {
                    label: "Cascade on debate101.org",
                    click: () => shell.openExternal("https://debate101.org/flow/"),
                },
                ...(isMac
                    ? []
                    : [
                          {
                              label: "About Cascade",
                              click: () =>
                                  dialog.showMessageBox({
                                      type: "info",
                                      title: "About Cascade",
                                      message: `Cascade ${app.getVersion()}`,
                                      detail:
                                          "Debate 101's keyboard-first flowing app.\nFlow format compatible with ebb v3.",
                                  }),
                          },
                      ]),
                { type: "separator" },
                {
                    label: "ebb File Format",
                    click: () => shell.openExternal("https://github.com/shreerammodi/ebb"),
                },
            ],
        },
    ];

    return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
