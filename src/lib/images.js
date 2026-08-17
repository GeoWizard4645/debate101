/**
 * Team photo delivery.
 *
 * The source headshots in assets/ are camera-resolution PNGs — 46 MB across
 * seven files, one of them 18 MB — and they are displayed at 120px on the team
 * page and 46px on the index. Serving the originals meant every visitor pulled
 * tens of megabytes to render thumbnails.
 *
 * assets/opt/ holds 640px JPEG derivatives of the same images (704 KB in
 * total). The originals are untouched and still in the repo; this only changes
 * which file the browser is asked for, and `onImageError` falls back to the
 * original if a derivative is ever missing.
 */

/** The optimized derivative for an asset path, or the path itself. */
export function optimized(src) {
    if (!src) return src;
    // The logo keeps its transparency, so it is deliberately not remapped.
    if (/logo\.png$/i.test(src)) return src;
    const match = /^(.*\/)?([^/]+)\.(png|jpe?g)$/i.exec(src);
    if (!match) return src;
    const [, dir = "", name] = match;
    return `${dir}opt/${name}.jpg`;
}

/**
 * onError handler: try the original once, then give up quietly. Guarded with a
 * dataset flag so a genuinely missing image cannot loop.
 */
export function onImageError(originalSrc) {
    return (event) => {
        const img = event.currentTarget;
        if (img.dataset.fallbackTried === "1") {
            img.style.visibility = "hidden";
            return;
        }
        img.dataset.fallbackTried = "1";
        img.src = originalSrc;
    };
}
