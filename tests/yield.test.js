import { describe, it, expect, afterEach, vi } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * Before a process runs, QSL yields to the main thread with
 * scheduler.yield() where the browser has it, so processes released
 * together run as separate tasks and input is handled in between.
 */

const original = globalThis.scheduler;

afterEach(() => {
    globalThis.scheduler = original;
});

/**
 * A task-based stand-in that counts its calls.
 */
function stubScheduler() {
    const stub = { calls: 0, yield: () => { stub.calls++; return new Promise((r) => setTimeout(r, 0)); } };
    globalThis.scheduler = stub;
    return stub;
}

async function setup() {
    const core = await freshCore();
    const log = [];
    core.registerType('mark', (p) => {
        log.push(p.id.replace(/^qsl-/, ''));
        /**
         * Work the page queues while this process runs, e.g. an input
         * handler: with yielding it runs before the next process.
         */
        if (p.queue) setTimeout(() => log.push('page task'), 0);
    });
    return { core, log };
}

describe('yield', () => {
    it('is on by default', async () => {
        const core = await freshCore();
        expect(core.yield).toBe(true);
    });

    it('yields once before each process that runs, not for skipped ones', async () => {
        const stub = stubScheduler();
        const { core, log } = await setup();
        core.add({ id: 'a', type: 'mark' });
        core.add({ id: 'b', type: 'mark' }, 'other');
        core.add({ id: 'c', type: 'mark', condition: () => false });
        await core.load();

        expect(log.sort()).toEqual(['a', 'b']);
        expect(stub.calls).toBe(2);
    });

    it('lets the page run between two processes of an ordered chain', async () => {
        stubScheduler();
        const { core, log } = await setup();
        core.add({ id: 'a', type: 'mark', queue: true }, true);
        core.add({ id: 'b', type: 'mark' }, true);
        await core.load();

        expect(log).toEqual(['a', 'page task', 'b']);
    });

    it('lets the page run between a dependency and what it releases, across flows', async () => {
        stubScheduler();
        const { core, log } = await setup();
        core.add({ id: 'sdk', type: 'mark', queue: true }, 'sdk');
        core.add({ id: 'plugin', type: 'mark', depends: ['sdk'] }, 'plugins');
        await core.load();

        expect(log).toEqual(['sdk', 'page task', 'plugin']);
    });

    it('runs straight through with qsl.yield = false', async () => {
        const stub = stubScheduler();
        const { core, log } = await setup();
        core.yield = false;
        core.add({ id: 'a', type: 'mark', queue: true }, true);
        core.add({ id: 'b', type: 'mark' }, true);
        await core.load();

        expect(stub.calls).toBe(0);
        expect(log.slice(0, 2)).toEqual(['a', 'b']);
    });

    it('changes nothing where the browser has no scheduler.yield()', async () => {
        globalThis.scheduler = undefined;
        const { core, log } = await setup();
        core.add({ id: 'a', type: 'mark', queue: true }, true);
        core.add({ id: 'b', type: 'mark' }, true);
        await core.load();

        expect(log.slice(0, 2)).toEqual(['a', 'b']);
    });

    it('does not count against the timeout', async () => {
        vi.useFakeTimers();
        globalThis.scheduler = { yield: () => new Promise((r) => setTimeout(r, 500)) };
        const { core, log } = await setup();
        const errors = [];
        const onError = (e) => errors.push(e.detail.id);
        window.addEventListener('QSL:error', onError);
        core.add({ id: 'a', type: 'mark', timeout: 100 });
        const done = core.load();
        await vi.advanceTimersByTimeAsync(600);
        await done;
        vi.useRealTimers();

        window.removeEventListener('QSL:error', onError);

        expect(log).toEqual(['a']);
        expect(errors).toEqual([]);
    });
});
