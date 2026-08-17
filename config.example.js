/*
 * Optional local configuration.
 *
 * ⚠ You almost certainly do not need this file any more.
 *
 * The site's AI features (Resolution AI and the FAQ Mentor) now run a language
 * model inside the visitor's own browser via Transformers.js — SmolLM2-135M-
 * Instruct at 4-bit, roughly 100 MB fetched once into Cache Storage and then
 * available offline. There is no API call, no key, no quota, and no per-question
 * cost, which is why the old client-side rate limiting is gone too.
 *
 * See the "ON-DEVICE AI" block in index.html.
 *
 * This file is kept only so that:
 *   - an existing config.js keeps loading without a 404, and
 *   - a future server-backed feature has an obvious place to read a key from.
 *
 * If you ever do reintroduce a hosted model on a static site, remember the key
 * ships to the browser. Restrict it in the provider's console — by HTTP
 * referrer to debate101.org, to the single API it needs, and with a hard quota
 * or budget cap — because nothing in client-side JavaScript can protect it.
 */
window.GEMINI_API_KEY = "";
