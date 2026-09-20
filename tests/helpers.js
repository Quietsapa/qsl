import { vi } from 'vitest';

/**
 * The core is a module singleton, so every test needs its own copy.
 *
 * @returns {Promise<Object>} A freshly evaluated, initialised core.
 */
export async function freshCore() {
    vi.resetModules();
    const mod = await import('../src/core.js');
    const core = mod.default;
    await core.init();
    return core;
}

/**
 * Register a trigger plugin against a minimal stub and resolve one option
 * through it, without pulling in the whole core.
 *
 * @param {Function} register - Trigger registrar, e.g. `hoverTrigger`.
 * @param {*} opt - Trigger option to resolve.
 * @param {Object} [o] - Flow or process the trigger belongs to.
 * @returns {Function|null} The trigger function, or null if unhandled.
 */
export function resolveTrigger(register, opt, o = {}) {
    const stub = { triggerHandlers: new Set() };
    register(stub);
    for (const handler of stub.triggerHandlers) {
        const fn = handler.call(stub, opt, o);
        if (typeof fn === 'function') return fn;
    }
    return null;
}

/**
 * Same idea for condition plugins.
 *
 * @param {Function} register - Condition registrar, e.g. `urlCondition`.
 * @param {*} opt - Condition option to evaluate.
 * @returns {boolean|null} True when the condition FAILS (core's convention).
 */
export function resolveCondition(register, opt) {
    const stub = { conditionHandlers: new Set() };
    register(stub);
    for (const handler of stub.conditionHandlers) {
        const result = handler.call(stub, opt);
        if (result === true || result === false) return result;
    }
    return null;
}

/**
 * Wait until a predicate holds, polling the microtask/timer queue.
 *
 * @param {Function} predicate - Returns truthy when the wait is over.
 * @param {number} [timeout=1000] - Milliseconds before giving up.
 * @returns {Promise<void>}
 */
export function waitFor(predicate, timeout = 1000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - started > timeout) return reject(new Error('waitFor timed out'));
            setTimeout(tick, 5);
        };
        tick();
    });
}
