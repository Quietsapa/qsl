import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { freshCore } from './helpers.js';
import { Script } from '../src/types.js';

/**
 * `retries` gives a failed load more attempts before the process settles as
 * failed. The timeout, when there is one, is the budget for all of them.
 */

beforeEach(() => {
    document.head.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * A type that fails its first `fails` attempts, then succeeds.
 */
function flaky(fails) {
    const calls = [];
    const handler = (process, callbacks) => {
        calls.push({ onError: process.onError, retrying: !!callbacks.retrying });
        return calls.length <= fails ? Promise.reject(new Error('attempt ' + calls.length)) : undefined;
    };
    return { handler, calls };
}

function record(core) {
    core.useEvents();
    const events = [];
    const fns = ['completed', 'error', 'skipped'].map((name) => {
        const fn = (e) => events.push({ name, id: e.detail.id.replace(/^qsl-/, ''), reason: e.detail.reason, error: e.detail.error });
        window.addEventListener('QSL:' + name, fn);
        return [name, fn];
    });
    events.stop = () => fns.forEach(([n, fn]) => window.removeEventListener('QSL:' + n, fn));
    return events;
}

describe('retries', () => {
    it('makes one attempt by default', async () => {
        const core = await freshCore();
        const { handler, calls } = flaky(1);
        core.registerType('flaky', handler);
        const events = record(core);
        core.add({ id: 'x', type: 'flaky' });
        await core.load();
        events.stop();

        expect(core.retries).toBe(0);
        expect(calls.length).toBe(1);
        expect(events.map((e) => e.name)).toEqual(['error']);
    });

    it('completes when a later attempt succeeds, with no error and no onError', async () => {
        const core = await freshCore();
        const { handler, calls } = flaky(2);
        core.registerType('flaky', handler);
        const events = record(core);
        const errors = [];
        const lines = [];
        core.setLogger({ log: (...a) => lines.push(a), error: () => {} });

        core.add({ id: 'x', type: 'flaky', retries: 2, onError: (e) => errors.push(e) });
        await core.load();
        events.stop();

        expect(calls.length).toBe(3);
        expect(events.map((e) => e.name)).toEqual(['completed']);
        expect(errors).toEqual([]);
        expect(lines.filter((l) => l[0] === 'PROCESS_RETRY')).toEqual([
            ['PROCESS_RETRY', 'qsl-x', 1],
            ['PROCESS_RETRY', 'qsl-x', 2],
        ]);
    });

    it('hides onError from every attempt but the last, and marks them retrying', async () => {
        const core = await freshCore();
        const { handler, calls } = flaky(5);
        core.registerType('flaky', handler);
        const onError = () => {};
        core.add({ id: 'x', type: 'flaky', retries: 2, onError });
        await core.load();

        expect(calls).toEqual([
            { onError: null, retrying: true },
            { onError: null, retrying: true },
            { onError, retrying: false },
        ]);
    });

    it('fails with the last error once the retries run out, and strict dependents skip', async () => {
        const core = await freshCore();
        const { handler, calls } = flaky(5);
        core.registerType('flaky', handler);
        core.registerType('ok', () => {});
        const events = record(core);

        core.add({ id: 'x', type: 'flaky', retries: 2 });
        core.add({ id: 'y', type: 'ok', depends: ['x'], strict: true });
        await core.load();
        events.stop();

        expect(calls.length).toBe(3);
        expect(events.find((e) => e.name === 'error').error.message).toBe('attempt 3');
        expect(events.find((e) => e.id === 'y')).toMatchObject({ name: 'skipped', reason: 'dependency' });
    });

    it('takes the nearest setting: process, then flow, then instance', async () => {
        const core = await freshCore();
        const a = flaky(9), b = flaky(9), c = flaky(9);
        core.registerType('a', a.handler);
        core.registerType('b', b.handler);
        core.registerType('c', c.handler);
        core.retries = 1;
        core.setFlowOptions({ retries: 3 }, 'f');

        core.add({ id: 'a', type: 'a' }, 'f');
        core.add({ id: 'b', type: 'b', retries: 0 }, 'f');
        core.add({ id: 'c', type: 'c' });
        await core.load();

        expect(a.calls.length).toBe(4);
        expect(b.calls.length).toBe(1);
        expect(c.calls.length).toBe(2);
    });

    it('ignores nonsense values', async () => {
        const core = await freshCore();
        const a = flaky(9), b = flaky(9);
        core.registerType('a', a.handler);
        core.registerType('b', b.handler);
        core.add({ id: 'a', type: 'a', retries: -2 });
        core.add({ id: 'b', type: 'b', retries: '3' });
        await core.load();

        expect(a.calls.length).toBe(1);
        expect(b.calls.length).toBe(1);
    });
});

describe('retries and timeout', () => {
    it('shares one timeout across all attempts', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        let calls = 0;
        core.registerType('slowfail', () => {
            calls++;
            return new Promise((_, reject) => setTimeout(() => reject(new Error('nope')), 400));
        });
        const events = record(core);

        core.add({ id: 'x', type: 'slowfail', retries: 10, timeout: 1000 });
        core.load();
        await vi.advanceTimersByTimeAsync(3000);
        events.stop();

        /**
         * Attempts start at 0, 400 and 800 ms; the third fails at 1200,
         * after the deadline, and is not followed by a fourth.
         */
        expect(calls).toBe(3);
        expect(events.map((e) => e.name)).toEqual(['error']);
        expect(events[0].error.name).toBe('TimeoutError');
    });

    it('never retries an attempt that timed out', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        let calls = 0;
        core.registerType('hang', () => { calls++; return new Promise(() => {}); });

        core.add({ id: 'x', type: 'hang', retries: 3, timeout: 100 });
        core.load();
        await vi.advanceTimersByTimeAsync(1000);

        expect(calls).toBe(1);
    });
});

describe('retryDelay', () => {
    /**
     * A type that fails every attempt and records when each one started.
     */
    function failing() {
        const starts = [];
        const handler = () => { starts.push(Date.now()); return Promise.reject(new Error('down')); };
        return { handler, starts };
    }

    it('waits the delay before each retry, not before the first attempt', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        const { handler, starts } = failing();
        core.registerType('down', handler);
        const t0 = Date.now();

        core.add({ id: 'x', type: 'down', retries: 2, retryDelay: 500 });
        const done = core.load();
        await vi.advanceTimersByTimeAsync(2000);
        await done;

        expect(starts.map((t) => t - t0)).toEqual([0, 500, 1000]);
    });

    it('retries at once without it', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        const { handler, starts } = failing();
        core.registerType('down', handler);
        const t0 = Date.now();

        core.add({ id: 'x', type: 'down', retries: 2 });
        const done = core.load();
        await vi.advanceTimersByTimeAsync(10);
        await done;

        expect(starts.map((t) => t - t0)).toEqual([0, 0, 0]);
    });

    it('takes the nearest setting: process, then flow, then instance', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        const a = failing(), b = failing(), c = failing();
        core.registerType('a', a.handler);
        core.registerType('b', b.handler);
        core.registerType('c', c.handler);
        core.retryDelay = 100;
        core.setFlowOptions({ retries: 1, retryDelay: 300 }, 'f');
        const t0 = Date.now();

        core.add({ id: 'a', type: 'a' }, 'f');
        core.add({ id: 'b', type: 'b', retryDelay: 0 }, 'f');
        core.add({ id: 'c', type: 'c', retries: 1 });
        const done = core.load();
        await vi.advanceTimersByTimeAsync(1000);
        await done;

        expect(a.starts.map((t) => t - t0)).toEqual([0, 300]);
        expect(b.starts.map((t) => t - t0)).toEqual([0, 0]);
        expect(c.starts.map((t) => t - t0)).toEqual([0, 100]);
    });

    it('does nothing without retries', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        const { handler, starts } = failing();
        core.registerType('down', handler);

        core.add({ id: 'x', type: 'down', retryDelay: 500 });
        const done = core.load();
        await vi.advanceTimersByTimeAsync(10);
        await done;

        expect(starts.length).toBe(1);
    });

    it('counts against the timeout, and no attempt starts after it', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        const { handler, starts } = failing();
        core.registerType('down', handler);
        core.useEvents();
        const errors = [];
        const onError = (e) => errors.push(e.detail.error.name);
        window.addEventListener('QSL:error', onError);
        const t0 = Date.now();

        /**
         * Attempts at 0 and 400; the next is due at 800, after the deadline.
         */
        core.add({ id: 'x', type: 'down', retries: 5, retryDelay: 400, timeout: 700 });
        core.load();
        await vi.advanceTimersByTimeAsync(3000);
        window.removeEventListener('QSL:error', onError);

        expect(starts.map((t) => t - t0)).toEqual([0, 400]);
        expect(errors).toEqual(['TimeoutError']);
    });

    it('is inherited by a late flow', async () => {
        vi.useFakeTimers();
        const core = await freshCore();
        const late = failing();
        core.registerType('late', late.handler);
        core.registerType('adder', () => { core.add({ id: 'l', type: 'late' }, 'f'); });
        core.setFlowOptions({ retries: 1, retryDelay: 250 }, 'f');
        core.add({ id: 'a', type: 'adder' }, 'f');
        const done = core.load();
        await vi.advanceTimersByTimeAsync(1000);
        await done;

        expect(late.starts[1] - late.starts[0]).toBe(250);
    });
});

describe('retries with built-in types', () => {
    it('removes the failed <script> before the next attempt', async () => {
        const core = await freshCore();
        core.registerTypes([Script]);
        const append = document.head.appendChild.bind(document.head);
        let failures = 2;
        vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
            const { onload } = el;
            el.onload = null;
            append(el);
            const fail = failures-- > 0;
            queueMicrotask(() => (fail ? el.onerror : onload)?.(new Event(fail ? 'error' : 'load')));
            return el;
        });
        const events = record(core);
        core.autoReset = false;

        core.add({ id: 'lib', type: 'script', src: '/lib.js', retries: 2 });
        await core.load();
        events.stop();

        expect(events.map((e) => e.name)).toEqual(['completed']);
        expect(document.head.querySelectorAll('script[src="/lib.js"]').length).toBe(1);
    });

    it('calls onError once, and keeps the last element, when every attempt fails', async () => {
        const core = await freshCore();
        core.registerTypes([Script]);
        const append = document.head.appendChild.bind(document.head);
        vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
            el.onload = null;
            append(el);
            queueMicrotask(() => el.onerror?.(new Event('error')));
            return el;
        });
        const onError = vi.fn();
        core.autoReset = false;

        core.add({ id: 'lib', type: 'script', src: '/lib.js', retries: 2, onError });
        await core.load();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(document.head.querySelectorAll('script[src="/lib.js"]').length).toBe(1);
    });
});

describe('late flows', () => {
    it('inherit timeout and retries from the flow they were added to', async () => {
        const core = await freshCore();
        const late = flaky(9);
        core.registerType('late', late.handler);
        let lateFlow;
        core.registerType('adder', () => {
            core.add({ id: 'l', type: 'late' }, 'f');
            lateFlow = [...core.flowOptions.keys()].find((k) => k.startsWith('f+late-'));
        });
        core.setFlowOptions({ retries: 2, timeout: 5000 }, 'f');
        core.add({ id: 'a', type: 'adder' }, 'f');
        await core.load();

        expect(late.calls.length).toBe(3);
        expect(lateFlow).toBeTruthy();
    });
});
