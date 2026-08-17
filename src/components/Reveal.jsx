/**
 * Reveal-on-scroll wrapper.
 *
 * A component rather than a bare hook because the common case is a mapped list,
 * and calling a hook inside `.map()` breaks the Rules of Hooks — the hook count
 * changes whenever the list length does. Wrapping each item in its own
 * component gives every element its own stable hook call.
 */

import { useReveal } from "../lib/hooks.js";

export default function Reveal({ as: Tag = "div", delay = 0, className = "", children, ...rest }) {
    const ref = useReveal(delay);
    return (
        <Tag className={`reveal ${className}`.trim()} ref={ref} {...rest}>
            {children}
        </Tag>
    );
}
