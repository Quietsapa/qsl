import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * `timeout` bounds how long a process may take once it has started loading.
 * A resource that never answers — neither load nor error, as with a stalled
 * connection — would otherwise hold the whole run open.
 */

afterEach(() => {
    vi.useRealTimers();
});

/**
 * A type whose handler never settles: the stalled request.
 */
const hang = () => new Promise(() => {});

/**
 * A type that takes `wait` ms.
 */
const slow = (process) => new Promise((resolve) => setTimeout(resolve, process.wait || 0));

function record(core) {
    const events = [];
    const listeners = ['started', 'completed', 'error', 'skipped'].map((name) => {
        const fn = (e) => events.push({ name, id: e.detail.id, reason: e.detail.reason, error: e.detail.error });
        window.addEventListener('QSL:' + name, fn);
        return [name, fn];
    });
    events.stop = () => listeners.forEach(([n, fn]) => window.removeEventListener('QSL:' + n, fn));
    return events;
}

async function run(core, ms) {
    const loading = core.load();
    let resolved = false;
    loading.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(ms);
    return resolved;
}

describe('process timeout', () => {
    it('fails a process that never answers, with a TimeoutError, and lets the run finish', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('hang', hang);
        const events = record(core);
        const errors = [];

        core.add({ id: 'stalled', type: 'hang', timeout: 100, onError: (e) => errors.push(e.name) });

        expect(await run(core, 99)).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(0);
        events.stop();

        const error = events.find((e) => e.name === 'error');
        expect(error.id).toBe('qsl-stalled');
        expect(error.error.name).toBe('TimeoutError');
        expect(error.error.message).toBe('Timed out after 100 ms');
        expect(errors).toEqual(['TimeoutError']);
        expect(core.hasStarted).toBe(false);
    });

    it('does nothing to a process that finishes in time', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('slow', slow);
        const events = record(core);

        core.add({ id: 'quick', type: 'slow', wait: 50, timeout: 100 });
        expect(await run(core, 50)).toBe(true);

        /**
         * The timer must be gone: nothing more happens after the deadline.
         */
        await vi.advanceTimersByTimeAsync(200);
        events.stop();
        expect(events.map((e) => e.name)).toEqual(['started', 'completed']);
    });

    it('ignores a resource that arrives after the deadline', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('slow', slow);
        const events = record(core);

        core.add({ id: 'late', type: 'slow', wait: 300, timeout: 100 });
        await run(core, 400);
        events.stop();

        expect(events.map((e) => e.name)).toEqual(['started', 'error']);
    });

    it('skips strict dependents, and releases the others', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('hang', hang);
        const events = record(core);
        const ran = [];

        core.add({ id: 'sdk', type: 'hang', timeout: 100 });
        core.add({ id: 'plugin', depends: ['sdk'], strict: true, onComplete: () => ran.push('plugin') });
        core.add({ id: 'beacon', depends: ['sdk'], onComplete: () => ran.push('beacon') });

        expect(await run(core, 150)).toBe(true);
        events.stop();

        expect(ran).toEqual(['beacon']);
        expect(events.find((e) => e.id === 'qsl-plugin')).toMatchObject({ name: 'skipped', reason: 'dependency' });
    });

    it('marks the flow failed, so a strict flow depending on it is skipped', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('hang', hang);
        const ran = [];

        core.add({ id: 'sdk', type: 'hang', timeout: 100 }, 'analytics');
        core.setFlowOptions({ depends: ['analytics'], strict: true }, 'marketing');
        core.add({ id: 'pixel', onComplete: () => ran.push('pixel') }, 'marketing');

        expect(await run(core, 150)).toBe(true);
        expect(ran).toEqual([]);
    });

    it('does not count the wait for a trigger', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('slow', slow);
        const events = record(core);

        core.add({ id: 'deferred', type: 'slow', wait: 50, timeout: 100, trigger: (cb) => setTimeout(cb, 500) });

        expect(await run(core, 600)).toBe(true);
        events.stop();
        expect(events.map((e) => e.name)).toEqual(['started', 'completed']);
    });

    it.each([
        ['the process', { process: 100 }, true],
        ['the flow', { flow: 100 }, true],
        ['the instance', { instance: 100 }, true],
        ['nowhere', {}, false],
        ['the flow, but the process sets 0', { flow: 100, process: 0 }, false],
        ['the instance, but the flow sets 0', { instance: 100, flow: 0 }, false],
        ['a non-number', { process: '100' }, false],
    ])('a timeout set on %s → times out: %s', async (_, { process, flow, instance }, timesOut) => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('hang', hang);

        if (instance !== undefined) core.timeout = instance;
        if (flow !== undefined) core.setFlowOptions({ timeout: flow }, 'f');
        core.add({ id: 'x', type: 'hang', ...(process !== undefined ? { timeout: process } : {}) }, 'f');

        expect(await run(core, 200)).toBe(timesOut);
    });

    it('is logged as a failure with a TimeoutError', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.registerType('hang', hang);
        const lines = [];
        core.setLogger({ log: () => {}, error: (...a) => lines.push(a) });

        core.add({ id: 'x', type: 'hang', timeout: 100 });
        await run(core, 150);

        expect(lines.map(([type, id, error]) => [type, id, error.name, error.message]))
            .toEqual([['PROCESS_FAILED', 'qsl-x', 'TimeoutError', 'Timed out after 100 ms']]);
    });
});

describe('timeout default', () => {
    it('is off', async () => {
        const core = await freshCore();
        expect(core.timeout).toBe(0);
    });
});

describe('after a timeout', () => {
    it('the process is settled, so a type still polling can see it and stop', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        core.autoReset = false;
        let polls = 0;
        core.registerType('poll', (process) => new Promise(() => {
            (function poll() {
                if (core.processStates.has(process.id)) return;
                polls++;
                setTimeout(poll, 50);
            })();
        }));
        core.add({ id: 'x', type: 'poll', timeout: 200 });
        core.load();
        await vi.advanceTimersByTimeAsync(1000);
        const after = polls;
        await vi.advanceTimersByTimeAsync(1000);

        expect(after).toBeLessThanOrEqual(5);
        expect(polls).toBe(after);
    });
});
