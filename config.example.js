/*
 * Copy this file to `config.js` and paste your Gemini API key below.
 * `config.js` is gitignored so your key is never committed.
 *
 * ⚠ THIS KEY SHIPS TO THE BROWSER.
 *
 * debate101.org is a static site, so whatever key ends up in config.js is
 * readable by anyone who opens devtools. The site rate-limits its own AI
 * features in index.html (see AI_LIMITS: a 6-second cooldown, 15 questions
 * per hour and 60 per rolling day, one request in flight at a time, and a
 * trimmed conversation history so a long chat does not cost quadratically
 * more tokens). Those limits protect the quota from ordinary use and from an
 * impatient visitor — they are NOT a security control, because someone can
 * lift the key out of the page and skip them entirely.
 *
 * The protections that actually bind live in Google Cloud Console, and you
 * should set all three on a personal key:
 *
 *   1. Application restriction → HTTP referrers:
 *        https://debate101.org/*
 *        https://www.debate101.org/*
 *   2. API restriction → Generative Language API only.
 *   3. A quota cap and a budget alert on the project, so a leaked key costs
 *      you a capped amount rather than an open-ended one.
 *
 * Rotate the key if it ever appears outside those referrers.
 *
 * In production this file is generated at deploy time by
 * .github/workflows/deploy.yml from the GEMINI_API_KEY repository secret.
 */
window.GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
