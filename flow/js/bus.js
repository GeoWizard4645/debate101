/**
 * Cascade — tiny synchronous pub/sub used for cross-module messages.
 *
 * Feature modules never import each other. They talk over this bus, so the
 * timer can tell the grid a speech started without either one knowing the
 * other exists. Handlers run synchronously in registration order; a throwing
 * handler is logged and the rest still run, because one broken panel must not
 * stop an autosave that is listening on the same topic.
 */

const handlers = new Map();

/** Subscribe to a topic. Returns an unsubscribe function. */
export function on(topic, fn) {
    if (!handlers.has(topic)) handlers.set(topic, new Set());
    handlers.get(topic).add(fn);
    return () => off(topic, fn);
}

/** Subscribe for exactly one delivery. */
export function once(topic, fn) {
    const un = on(topic, (payload) => {
        un();
        fn(payload);
    });
    return un;
}

/** Unsubscribe a handler. */
export function off(topic, fn) {
    handlers.get(topic)?.delete(fn);
}

/** Publish to a topic. Never throws. */
export function emit(topic, payload) {
    const set = handlers.get(topic);
    if (!set) return;
    for (const fn of [...set]) {
        try {
            fn(payload);
        } catch (err) {
            console.error(`[bus] handler for "${topic}" threw:`, err);
        }
    }
}

export const bus = { on, once, off, emit };
export default bus;
