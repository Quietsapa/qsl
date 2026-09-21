import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { freshCore } from './helpers.js';
import logger from '../src/plugins/logger.js';

/**
 * The logger turns QSL's message keys into readable console lines. The core
 * and the types only ever send keys, so the one thing that can silently rot is
 * a key without a message.
 */

async function withLogger() {
    const core = await freshCore();
    core.use(logger);
    /**
     * The logger installs itself from an init action; run it again now that
     * it is registered.
     */
    core.initialized = false;
    await core.init();
    return core;
}

describe('logger plugin', () => {
    it('installs itself as the logger on init', async () => {
        const core = await withLogger();
        expect(core.logger.VERSION).toBe('qsl-logger');
    });

    it('prints a known key as its message, followed by the arguments and a timestamp', async () => {
        const core = await withLogger();
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

        core.log('DEP_NOT_FOUND', 'qsl-x', 'nope');

        const [message, ...rest] = spy.mock.calls[0];
        expect(message).toBe('[QSL] Dependency not found:');
        expect(rest.slice(0, 2)).toEqual(['qsl-x', 'nope']);
        expect(rest[2]).toHaveProperty('timestamp');
    });

    it('prints an unknown key as it is, rather than dropping it', async () => {
        const core = await withLogger();
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

        core.log('hello from a console process');

        expect(spy.mock.calls[0][0]).toBe('[QSL] hello from a console process');
    });

    it('sends errors to console.error, known and unknown alike', async () => {
        const core = await withLogger();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        core.error('PROCESS_FAILED', 'qsl-x');
        core.error('SOMETHING_NEW', 'qsl-y');

        expect(spy.mock.calls[0]).toEqual(['[QSL] Process failed:', 'qsl-x']);
        expect(spy.mock.calls[1]).toEqual(['[QSL] SOMETHING_NEW', 'qsl-y']);
    });

    it('has a message for every key the source sends', async () => {
        const core = await withLogger();
        const sources = ['src/core.js', 'src/types.js'].map((f) => readFileSync(f, 'utf8')).join('\n');

        const keys = new Set();
        for (const match of sources.matchAll(/this\.(?:log|error)\('([A-Z_]+)'/g)) keys.add(match[1]);
        for (const match of sources.matchAll(/type: '([A-Z_]+)'/g)) keys.add(match[1]);

        expect(keys.size).toBeGreaterThan(10);
        const missing = [...keys].filter((key) => !core.logger.LOG[key]);
        expect(missing).toEqual([]);
    });
});
