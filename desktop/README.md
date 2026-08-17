# Cascade desktop

The Electron shell around [`/flow`](../flow/ARCHITECTURE.md) — Debate 101's
flowing app. This directory doesn't contain any debate-flowing logic; it's a
window, a native menu, and file-system access the browser sandbox can't
grant on its own (native Open/Save dialogs, `.ebb` double-click-to-open).
The app that actually runs inside the window is the same, unmodified
`/flow` you'd get at **https://debate101.org/flow/** — see
["The identical app runs in a browser" below](#the-identical-app-runs-in-a-browser).

## Run it in dev

```sh
cd desktop
npm install
npm start
```

That's it — `npm start` runs `electron .`, which loads `main.js`, which
serves `../flow` over a custom `app://` protocol (see the comment at the top
of `main.js` for why plain `file://` doesn't work for native ES modules) and
opens a window pointed at it. Edits to anything under `/flow` show up on the
next `Cmd/Ctrl+R` reload — there's no build step for the web app, and none
was added here either.

## Build installers

```sh
npm run dist:mac      # .dmg, arm64 + x64
npm run dist:win      # NSIS installer, x64
npm run dist:linux    # AppImage + .deb, x64
npm run dist          # whatever electron-builder infers for the current OS
```

Installers land in `desktop/dist/`. Before building a *real* release, drop
platform icons into `desktop/build/` — see `desktop/build/README.md` for
exactly which files and how to generate them. Without them, electron-builder
falls back to Electron's default icon, which is fine for local testing.

### Unsigned macOS builds

There's no Apple Developer certificate wired up yet (`package.json`'s
`build.mac.identity` is explicitly `null`), so `.dmg` builds from
`npm run dist:mac` are unsigned and unnotarized. macOS Gatekeeper will
refuse to open an unsigned app with a normal double-click
("*Cascade* is damaged and can't be opened" / "*Cascade* can't be opened
because it is from an unidentified developer"). To run it anyway:

1. Right-click (or Control-click) `Cascade.app` → **Open**.
2. Click **Open** again in the dialog that appears.

This only needs to happen once per build. Once a signing identity exists,
set `build.mac.identity` in `package.json` to the real
`"Developer ID Application: ..."` string (or drop the override entirely and
let electron-builder auto-detect a certificate in the keychain) and this
step goes away.

### `.ebb` file association

All three installers register **`.ebb`** as a Cascade document type (see the
`fileAssociations` / `mac.extendInfo` blocks in `package.json`), so:

- Double-clicking a `.ebb` file opens it in Cascade (launching the app if
  it isn't running, or handing the path to the already-running instance —
  see the single-instance-lock handling in `main.js`).
- On macOS, `.ebb` gets a real Uniform Type Identifier
  (`org.debate101.cascade.ebb`, conforming to `public.json` since that's
  what a `.ebb` file actually is under the hood) so Finder, Spotlight, and
  QuickLook treat it as a proper document type instead of a bare extension
  guess.
- Dragging a `.ebb` onto the Dock icon (macOS) or the taskbar shortcut
  (Windows) opens it the same way.

### Auto-updates

Intentionally **not** wired up. There's a commented stub at the bottom of
`main.js` showing where `electron-updater` would go; it's off because
auto-updating unsigned builds is unsafe (the whole point of a code-signed
update channel is that the updater can verify what it's about to run) —
revisit once a signing certificate exists for both platforms.

## The identical app runs in a browser

Everything under `/flow` is the same code, unmodified, whether it's loaded
by this Electron shell or opened directly at **https://debate101.org/flow/**
in Chrome, Edge, Safari, or Firefox — no install, no account, works fully
offline once the page has loaded once. The desktop app exists for `.ebb`
file-association, native dialogs, and a proper dock/taskbar presence — not
because the web version is missing anything. `flow/js/store.js` and
`preload.js` (in this directory) are the only two files that know the
desktop shell exists at all; everything else in `/flow` has no idea which
shell it's running in.
