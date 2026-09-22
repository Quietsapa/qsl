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

    it('keeps QSL\'s own progress quiet unless qsl.debug is set', async () => {
        const core = await withLogger();
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

        core.log('PROCESS_STARTED', 'qsl-x');
        expect(spy).not.toHaveBeenCalled();

        core.debug = true;
        core.log('PROCESS_STARTED', 'qsl-x');
        expect(spy.mock.calls).toEqual([['[QSL] Process started:', 'qsl-x']]);
    });

    it('prints a known key as its message and the arguments, with no timestamp object', async () => {
        const core = await withLogger();
        core.debug = true;
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

        core.log('LATE_ADD', 'qsl-x', 'f', 'f+late-1');

        expect(spy.mock.calls[0]).toEqual(['[QSL] Added to a flow that has already started, runs in a late flow:', 'qsl-x', 'f', 'f+late-1']);
    });

    it('always prints errors, and the message of a console process', async () => {
        const core = await withLogger();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        core.registerType('fail', () => Promise.reject(new Error('down')));
        core.add({ id: 'hello', message: 'hello from a console process' });
        core.add({ id: 'x', type: 'fail' });
        core.add({ id: 'y', type: 'carousel' });
        core.add({ id: 'z', depends: ['nope'] });
        await core.load();

        expect(log.mock.calls).toEqual([['[QSL] hello from a console process']]);
        expect(error.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([
            '[QSL] Process failed:', '[QSL] Unknown type:', '[QSL] Dependency not found:',
        ]));
    });

    it('prints an Event as its type and source, not the Event, which would keep its element alive', async () => {
        const core = await withLogger();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const img = document.createElement('img');
        img.src = 'https://cdn.example/p.gif';
        const event = new Event('error');
        Object.defineProperty(event, 'target', { value: img });

        core.error('PROCESS_FAILED', 'qsl-p', event);

        expect(spy.mock.calls[0]).toEqual(['[QSL] Process failed:', 'qsl-p', 'error https://cdn.example/p.gif']);
        expect(spy.mock.calls[0].some((a) => a instanceof Event)).toBe(false);
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
