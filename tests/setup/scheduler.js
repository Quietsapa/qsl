/**
 * A task-based scheduler.yield() stand-in, as in Chromium.
 */
globalThis.scheduler = { yield: () => new Promise((r) => setTimeout(r, 0)) };
