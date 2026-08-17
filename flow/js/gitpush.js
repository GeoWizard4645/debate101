/**
 * Cascade — rename + push a flow to Git.
 *
 * Web: GitHub Contents API (needs a personal access token with repo scope).
 * Desktop: if the flow file already lives inside a git checkout, runs
 * `git add`, `commit`, and `push` locally instead.
 */

import { store } from "./store.js";
import { ui } from "./ui.js";
import { el } from "./dom.js";
import { registerAll } from "./registry.js";
import { serializeFlow, suggestFilename } from "./ebbfile.js";

const LS_REPO = "cascade.git.repo";
const LS_BRANCH = "cascade.git.branch";
const LS_PREFIX = "cascade.git.prefix";
const LS_TOKEN = "cascade.git.token";

function loadSetting(key, fallback = "") {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function saveSetting(key, value) {
    try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
    } catch {
        /* private browsing */
    }
}

function parseRepo(input) {
    const s = String(input ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(s);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
}

function repoPath(prefix, fileName) {
    const base = String(prefix ?? "flows/").replace(/^\/+/, "").replace(/\/+$/, "");
    const name = fileName || "flow.ebb";
    return base ? `${base}/${name}` : name;
}

function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

async function getGitHubFileSha(owner, repo, filePath, branch, token) {
    const url =
        `https://api.github.com/repos/${owner}/${repo}/contents/` +
        filePath.split("/").map(encodeURIComponent).join("/") +
        `?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const body = await res.json();
            detail = body.message || detail;
        } catch {
            /* ignore */
        }
        throw new Error(detail);
    }
    const data = await res.json();
    return data.sha ?? null;
}

async function pushViaGitHub({ owner, repo, branch, path, token, content, message }) {
    const sha = await getGitHubFileSha(owner, repo, path, branch, token);
    const url =
        `https://api.github.com/repos/${owner}/${repo}/contents/` +
        path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
            message,
            content: toBase64Utf8(content),
            branch,
            ...(sha ? { sha } : {}),
        }),
    });
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const body = await res.json();
            detail = body.message || detail;
        } catch {
            /* ignore */
        }
        throw new Error(detail);
    }
    return res.json();
}

async function tryLocalGitPush(filePath, message, content) {
    const desktop = window.cascadeDesktop;
    if (!desktop?.gitPush || !desktop?.writeFile) return null;

    let path = filePath;
    if (!path) {
        path = await desktop.showSaveDialog?.({
            defaultPath: store.fileName || suggestFilename(store.round),
        });
        if (!path) return { cancelled: true };
    }

    await desktop.writeFile(path, content);
    store.markSaved?.(path.split(/[\\/]/).pop(), { via: "desktop", path });
    try {
        const result = await desktop.gitPush({ path, message });
        return { ok: true, path, ...result };
    } catch (err) {
        return { error: err.message, path };
    }
}

export async function openPushDialog() {
    if (!store.round) return;

    const defaultTitle = store.getDisplayName?.() ?? "Untitled flow";
    const defaultFile = store.fileName || suggestFilename(store.round);

    const titleInput = el("input", { type: "text", value: defaultTitle, placeholder: "Flow title / commit message" });
    const repoInput = el("input", {
        type: "text",
        value: loadSetting(LS_REPO),
        placeholder: "owner/repo or github.com/owner/repo",
    });
    const branchInput = el("input", { type: "text", value: loadSetting(LS_BRANCH, "main"), placeholder: "main" });
    const prefixInput = el("input", {
        type: "text",
        value: loadSetting(LS_PREFIX, "flows"),
        placeholder: "flows",
    });
    const pathInput = el("input", {
        type: "text",
        value: repoPath(loadSetting(LS_PREFIX, "flows"), defaultFile),
        placeholder: "flows/My Flow.ebb",
    });
    const tokenInput = el("input", {
        type: "password",
        value: loadSetting(LS_TOKEN),
        placeholder: "GitHub personal access token",
        autocomplete: "off",
    });
    const rememberToken = el("input", { type: "checkbox", id: "git-remember-token", checked: !!loadSetting(LS_TOKEN) });

    const syncPath = () => {
        const name = `${defaultTitle.trim() || "flow"}.ebb`.replace(/[/\\:*?"<>|]/g, "-");
        pathInput.value = repoPath(prefixInput.value, store.fileName || name);
    };
    titleInput.addEventListener("input", () => {
        const safe = `${titleInput.value.trim() || "flow"}.ebb`.replace(/[/\\:*?"<>|]/g, "-");
        pathInput.value = repoPath(prefixInput.value, safe);
    });
    prefixInput.addEventListener("input", syncPath);

    const body = el(
        "div.git-push-form",
        { style: { display: "flex", flexDirection: "column", gap: "10px" } },
        el("p", {
            style: { margin: "0 0 4px", opacity: "0.8", fontSize: "13px" },
            text: "Rename this flow, then push it to GitHub. On desktop, if the file is already in a local git repo, Cascade runs git add / commit / push instead.",
        }),
        el("label", {}, "Flow title", titleInput),
        el("label", {}, "GitHub repo", repoInput),
        el("label", {}, "Branch", branchInput),
        el("label", {}, "Folder in repo", prefixInput),
        el("label", {}, "File path in repo", pathInput),
        el("label", {}, "GitHub token (repo scope)", tokenInput),
        el("label", { style: { display: "flex", gap: "8px", alignItems: "center" } }, rememberToken, " Remember token on this device"),
        el("p", {
            style: { margin: 0, fontSize: "11px", opacity: "0.65" },
            text: "Create a token at github.com/settings/tokens with Contents read & write. It stays in this browser only.",
        }),
    );

    const action = await ui.modal({
        title: "Push flow to Git",
        body,
        actions: [
            { id: "cancel", label: "Cancel" },
            { id: "push", label: "Push", primary: true },
        ],
        width: 520,
    });
    if (action !== "push") return;

    const title = titleInput.value.trim();
    if (!title) {
        ui.toast("Enter a flow title.", { type: "warn" });
        return;
    }

    store.renameFlow?.(title);
    const content = serializeFlow(store.round);
    const message = `Update flow: ${title}`;

    saveSetting(LS_REPO, repoInput.value.trim());
    saveSetting(LS_BRANCH, branchInput.value.trim() || "main");
    saveSetting(LS_PREFIX, prefixInput.value.trim());
    if (rememberToken.checked) saveSetting(LS_TOKEN, tokenInput.value.trim());
    else saveSetting(LS_TOKEN, "");

    try {
        const local = await tryLocalGitPush(store.filePath, message, content);
        if (local?.cancelled) return;
        if (local?.ok) {
            ui.toast(`Pushed to git (${local.path})`, { type: "success", ms: 5000 });
            store.markSaved?.(store.fileName, { via: "git" });
            return;
        }
        if (local?.error) {
            ui.toast(`Local git failed — trying GitHub… (${local.error})`, { type: "warn", ms: 5000 });
        }
    } catch (err) {
        ui.toast(`Local git failed — trying GitHub… (${err.message})`, { type: "warn", ms: 5000 });
    }

    const parsed = parseRepo(repoInput.value);
    const token = tokenInput.value.trim();
    if (!parsed) {
        ui.toast("Enter a repo as owner/name.", { type: "error" });
        return;
    }
    if (!token) {
        ui.toast("A GitHub token is required for web push.", { type: "error" });
        return;
    }

    const branch = branchInput.value.trim() || "main";
    const filePath = pathInput.value.trim().replace(/^\/+/, "");
    if (!filePath) {
        ui.toast("Enter a file path in the repo.", { type: "error" });
        return;
    }

    try {
        await pushViaGitHub({
            owner: parsed.owner,
            repo: parsed.repo,
            branch,
            path: filePath,
            token,
            content,
            message,
        });
        store.markSaved?.(`${filePath.split("/").pop()}`, { via: "github" });
        ui.toast(`Pushed to ${parsed.owner}/${parsed.repo}`, { type: "success", ms: 5000 });
    } catch (err) {
        ui.toast(`Git push failed: ${err.message}`, { type: "error", ms: 8000 });
    }
}

export function init() {
    registerAll([
        {
            id: "flow.pushGit",
            title: "Push flow to Git…",
            category: "File",
            keys: ["Mod+Shift+G"],
            run: openPushDialog,
        },
    ]);

    ui.addToolbarButton({
        id: "git.push",
        label: "Git",
        icon: "⬆",
        title: "Rename and push this flow to Git (Mod+Shift+G)",
        slot: "right",
        onClick: openPushDialog,
    });
}

export default { init, openPushDialog };
