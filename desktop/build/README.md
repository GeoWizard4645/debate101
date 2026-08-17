# Icons go here

This folder is electron-builder's `buildResources` directory
(`build.directories.buildResources` in `desktop/package.json`). electron-builder
looks for icons here **by filename convention** — no binary icon files are
checked into this repo, because they're generated assets, not source. Drop
these in before running `npm run dist*`:

| File                | Platform | Spec |
|---------------------|----------|------|
| `icon.icns`          | macOS    | Multi-resolution `.icns` (16–1024px, incl. @2x). |
| `icon.ico`            | Windows  | Multi-resolution `.ico` (16, 32, 48, 256px). |
| `icon.png`             | Linux    | Single `512x512` (or `1024x1024`) PNG, square, transparent background. |

All three should be generated from the same source mark: **`../../assets/logo.PNG`**
(repo root `assets/logo.PNG` — the same logo `flow/index.html` uses for its
favicon and start-screen wordmark). Keep them in sync if that file changes.

## How to generate them

You need a 1024x1024 (or larger) square PNG to start from — export one from
`assets/logo.PNG` if it isn't already square/high-res enough.

**macOS (`icon.icns`)**, using Apple's own `iconutil` (no extra tools needed):

```sh
mkdir icon.iconset
for size in 16 32 128 256 512; do
    sips -z $size $size source-1024.png --out "icon.iconset/icon_${size}x${size}.png"
    sips -z $((size*2)) $((size*2)) source-1024.png --out "icon.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
```

**Windows (`icon.ico`)** — electron-builder can build this for you from a
single PNG if you'd rather not: point `build.win.icon` at a 256x256+ PNG
instead of an `.ico` and it converts automatically. Otherwise use any
ico-packing tool (e.g. `png2ico`, ImageMagick's `convert`, or an online
converter) to bundle 16/32/48/256px sizes into one `.ico`.

**Linux (`icon.png`)** — just the square PNG itself, no packing needed:

```sh
sips -z 512 512 source-1024.png --out icon.png
```

## Why nothing is generated automatically

Binary icon files don't belong in a diff an agent (or a human reviewer) is
expected to read, and generating them requires either platform-specific
tools (`iconutil` is macOS-only) or a design pass (padding, background,
which asset export to start from) that's a design decision, not a build
step. Drop the three files in above once real ones exist; until then
electron-builder falls back to Electron's default icon, which is fine for
local `npm start` / `npm run pack` testing but shouldn't ship in a release
build.
