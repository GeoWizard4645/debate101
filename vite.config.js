import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cp, access, readdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Directories that are NOT part of this build and must reach the deployed site
 * byte-for-byte: Cascade, the standalone tools, the shared assets, the content
 * data the site fetches at runtime, and the root files GitHub Pages needs.
 *
 * In dev they already resolve, because Vite serves the project root statically.
 * This plugin only has to handle `vite build`, which would otherwise emit a
 * dist/ containing nothing but the React bundle.
 */
const PASSTHROUGH_DIRS = ["flow", "tools", "assets", "data"];
const PASSTHROUGH_FILES = [
    "CNAME",
    "LICENSE",
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "config.js",
    "config.example.js",
];

function copyStatic() {
    return {
        name: "debate101-copy-static",
        apply: "build",
        async closeBundle() {
            const root = process.cwd();
            const out = resolve(root, "dist");

            // Team headshots ship as camera-resolution PNGs (46 MB in total,
            // one of them 18 MB) and are rendered at 120px. assets/opt/ holds
            // 640px JPEG derivatives that the site actually requests, so the
            // originals stay in the repo as the source of truth but are kept
            // out of the deployed artifact. Anything without a derivative —
            // logo.PNG, most obviously — is copied normally.
            let optimizedNames = new Set();
            try {
                optimizedNames = new Set(
                    (await readdir(resolve(root, "assets", "opt")))
                        .map((f) => f.replace(/\.jpg$/i, "").toLowerCase()),
                );
            } catch {
                /* no derivatives generated; ship everything */
            }

            const skipped = [];
            const isSupersededOriginal = (src) => {
                const m = /assets[\\/]([^\\/]+)\.(png|jpe?g)$/i.exec(src);
                if (!m) return false;
                if (/[\\/]opt[\\/]/.test(src)) return false;
                if (!optimizedNames.has(m[1].toLowerCase())) return false;
                skipped.push(m[0]);
                return true;
            };

            for (const dir of PASSTHROUGH_DIRS) {
                const from = resolve(root, dir);
                try {
                    await access(from);
                } catch {
                    continue;
                }
                await cp(from, resolve(out, dir), {
                    recursive: true,
                    filter: (src) =>
                        // node_modules under desktop/ is enormous and never served.
                        !src.includes("node_modules") &&
                        !src.endsWith(".DS_Store") &&
                        !isSupersededOriginal(src),
                });
                this.info?.(`copied ${dir}/ into dist/`);
            }

            if (skipped.length) {
                this.info?.(
                    `left ${skipped.length} full-resolution original(s) out of dist/ ` +
                        `(optimized derivatives are in assets/opt/): ${skipped.join(", ")}`,
                );
            }

            for (const file of PASSTHROUGH_FILES) {
                const from = resolve(root, file);
                try {
                    await access(from);
                } catch {
                    continue;
                }
                await cp(from, resolve(out, file));
            }
        },
    };
}

export default defineConfig({
    plugins: [react(), copyStatic()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // The site is small; one bundle beats a waterfall of chunk requests.
        chunkSizeWarningLimit: 900,
    },
    server: {
        port: 5173,
        open: false,
    },
});
