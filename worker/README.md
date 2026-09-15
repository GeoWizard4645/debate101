# debate101-ai worker

Cloudflare Worker that fronts the Groq API for the static debate101.org site.
The Groq API key lives only here, as a Worker secret — never in the repo,
never in the browser.

## One-time deploy

```bash
cd worker
npm install -g wrangler
wrangler login                      # opens Cloudflare auth in a browser
wrangler secret put GROQ_API_KEY    # paste the key when prompted
wrangler deploy                     # prints the workers.dev URL
```

Free tier is fine; no paid Cloudflare plan needed.

## After deploy

1. Copy the deployed URL (e.g. `https://debate101-ai.<subdomain>.workers.dev`).
2. In the debate101 repo: Settings → Secrets and variables → Actions →
   **Variables** tab → add `GROQ_WORKER_URL` with that URL.
   The Pages deploy workflow writes it into `config.js` on every deploy, and
   the site reads `window.DEBATE101_AI_ENDPOINT` from there.
3. Redeploy the site (push to main, or re-run the Deploy workflow).

For local dev, create the gitignored `config.js` in the repo root:

```js
window.DEBATE101_AI_ENDPOINT = "https://debate101-ai.<subdomain>.workers.dev";
```

## Notes

- Rate limits (per-IP daily, global daily) and the model are `[vars]` in
  `wrangler.toml` — edit and `wrangler deploy` again to change them.
- Limits are per-isolate best-effort; the Groq free tier's own daily quota is
  the hard backstop.
- Rotate the key any time with `wrangler secret put GROQ_API_KEY`.
