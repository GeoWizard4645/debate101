/*
 * Optional local configuration.
 *
 * The site's AI features (Resolution AI and the FAQ mentor) call a model
 * (GPT-OSS 20B on Groq) through the debate101-ai Cloudflare Worker, which
 * holds the Groq API key server-side — see worker/. The key never ships to
 * the browser.
 *
 * What the browser DOES need is the Worker's URL. It is not a secret. The
 * Pages deploy workflow writes it into config.js from the GROQ_WORKER_URL
 * repo variable at deploy time; for local dev, copy this file to config.js
 * (gitignored) and fill in the URL from `wrangler deploy`.
 *
 * window.DEBATE101_AI_ENDPOINT is read by src/lib/ai.js.
 *
 * A note for the future: if you ever put an API key back in client-side code
 * on this static site, the key ships to the browser and will be scraped — it
 * happened before and Google suspended the project over it. Keys belong in
 * the Worker.
 */
window.DEBATE101_AI_ENDPOINT = "";
