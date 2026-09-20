/**
 * Built-in trigger handlers.
 *
 * A trigger handler receives the raw trigger option and the flow/process it
 * belongs to, and returns a function `(cb) => void` that invokes `cb` once the
 * trigger fires. Returning `null` means "not my trigger" and lets the next
 * registered handler try.
 */

/**
 * Read the argument part of a prefixed trigger option.
 *
 * Uses `slice` rather than `split(':')` so that arguments containing colons
 * (CSS pseudo-classes, media queries, URLs) survive intact.
 *
 * @param {string} opt - Full trigger option, e.g. `hover:.btn:first-child`.
 * @param {string} prefix - Prefix including the colon, e.g. `hover:`.
 * @returns {string} The argument, e.g. `.btn:first-child`.
 */
const arg = (opt, prefix) => opt.slice(prefix.length);

/**
 * Check whether an option is a string starting with the given prefix.
 *
 * @param {*} opt - Trigger option.
 * @param {string} prefix - Prefix including the colon.
 * @returns {boolean}
 */
const isPrefixed = (opt, prefix) => typeof opt === 'string' && opt.startsWith(prefix);

/**
 * Resolve an element now, or once it is inserted into the document.
 *
 * `appears:` and `visible:` may reference elements that are rendered later, so
 * a plain `querySelector` at registration time is not enough.
 *
 * @param {string} selector - CSS selector.
 * @param {Function} cb - Called with the element once it exists.
 * @returns {void}
 */
const whenElement = (selector, cb) => {
    let el = null;
    try {
        el = document.querySelector(selector);
    } catch (e) {
        /* Invalid selector: fail open so the flow is never stuck. */
        cb(null);
        return;
    }

    if (el) {
        cb(el);
        return;
    }

    if (typeof MutationObserver !== 'function') {
        cb(null);
        return;
    }

    const root = document.body || document.documentElement;
    if (!root) {
        cb(null);
        return;
    }

    const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
            observer.disconnect();
            cb(found);
        }
    });
    observer.observe(root, { childList: true, subtree: true });
};

/**
 * `load` - fires on the window load event.
 * @param {Object} QSL
 */
export function loadTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (opt !== 'load') return null;
        return (cb) => {
            if (document.readyState === 'complete') {
                cb();
            } else {
                window.addEventListener('load', () => cb(), { once: true });
            }
        };
    });
}

/**
 * `idle` - fires when the browser is idle.
 * @param {Object} QSL
 */
export function idleTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (opt !== 'idle') return null;
        return (cb) => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => cb());
            } else {
                setTimeout(() => cb(), 200);
            }
        };
    });
}

/**
 * `domready` - fires on DOMContentLoaded.
 *
 * `interactive` means DOMContentLoaded has already fired, so a listener added
 * at that point would never run.
 *
 * @param {Object} QSL
 */
export function domReadyTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (opt !== 'domready') return null;
        return (cb) => {
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                cb();
            } else {
                document.addEventListener('DOMContentLoaded', () => cb(), { once: true });
            }
        };
    });
}

/**
 * `delay:<ms>` - fires after a timeout.
 * @param {Object} QSL
 */
export function delayTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (!isPrefixed(opt, 'delay:')) return null;
        const ms = parseInt(arg(opt, 'delay:'), 10);
        return (cb) => setTimeout(cb, Number.isFinite(ms) && ms > 0 ? ms : 0);
    });
}

/**
 * `hover:<selector>` - fires when the pointer moves over the element.
 * @param {Object} QSL
 */
export function hoverTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (!isPrefixed(opt, 'hover:')) return null;
        const selector = arg(opt, 'hover:');
        return (cb) => {
            whenElement(selector, (el) => {
                if (!el) {
                    cb();
                    return;
                }
                el.addEventListener('mouseover', () => cb(), { once: true, passive: true });
            });
        };
    });
}

/**
 * `visible:<selector>` - fires when the element intersects the viewport.
 * @param {Object} QSL
 */
export function visibleTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (!isPrefixed(opt, 'visible:')) return null;
        const selector = arg(opt, 'visible:');
        return (cb) => {
            whenElement(selector, (el) => {
                if (!el || typeof IntersectionObserver !== 'function') {
                    cb();
                    return;
                }
                const observer = new IntersectionObserver((entries) => {
                    for (const entry of entries) {
                        if (entry.isIntersecting) {
                            observer.disconnect();
                            cb();
                            return;
                        }
                    }
                });
                observer.observe(el);
            });
        };
    });
}

/**
 * `appears:<selector>` - fires when the element is inserted into the DOM.
 * @param {Object} QSL
 */
export function appearsTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt) {
        if (!isPrefixed(opt, 'appears:')) return null;
        const selector = arg(opt, 'appears:');
        return (cb) => whenElement(selector, () => cb());
    });
}

/**
 * `media:<query>` - fires when the media query matches, now or later.
 * @param {Object} QSL
 */
export function mediaQueryTrigger(QSL) {
    QSL.triggerHandlers.add(function (opt, o) {
        if (!isPrefixed(opt, 'media:')) return null;
        const query = arg(opt, 'media:');
        return (cb) => {
            if (!query.length || typeof window.matchMedia !== 'function') {
                if (o) o.skipped = true;
                cb();
                return;
            }
            const mql = window.matchMedia(query);
            if (mql.matches) {
                cb();
                return;
            }
            const handler = (e) => {
                if (!e.matches) return;
                mql.removeEventListener('change', handler);
                cb();
            };
            mql.addEventListener('change', handler);
        };
    });
}

/**
 * Register every built-in trigger handler.
 * @param {Object} QSL
 */
export default function (QSL) {
    loadTrigger(QSL);
    idleTrigger(QSL);
    domReadyTrigger(QSL);
    delayTrigger(QSL);
    hoverTrigger(QSL);
    visibleTrigger(QSL);
    appearsTrigger(QSL);
    mediaQueryTrigger(QSL);
}
