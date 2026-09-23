import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * When things run, not only in what order. On virtual time, every start and
 * every settle is stamped with the millisecond it happened at, so the tests
 * can say exactly when a process starts: at once, or the moment the last
 * thing it waits for is done — never later, and never after an idle gap.
 */

afterEach(() => {
    vi.useRealTimers();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
    vi.useFakeTimers();
    const core = await freshCore();
    core.autoReset = false;

    /**
     * Exact milliseconds. With yield on, each process that runs also waits
     * one task where the browser has scheduler.yield(); what that costs is
     * yield.test.js's business.
     */
    core.yield = false;
    const t0 = Date.now();
    const started = {};
    const settled = {};
    const at = () => Date.now() - t0;
    core.registerType('work', (p) => sleep(p.ms || 0));
    core.registerType('fail', (p) => sleep(p.ms || 0).then(() => { throw new Error('fail'); }));
    core.registerType('hang', () => new Promise(() => {}));
    core.listeners.add(({ type, process }) => {
        if (!process) return;
        const id = process.id.replace(/^qsl-/, '');
        if (type === 'PROCESS_STARTED' && !(id in started)) started[id] = at();
        if (/^PROCESS_(COMPLETED|FAILED|SKIPPED)$/.test(type)) settled[id] = at();
    });
    const load = async (options) => {
        let end = null;
        core.load(options).then(() => { end = at(); });
        for (let i = 0; i < 100 && end === null; i++) await vi.advanceTimersByTimeAsync(10);
        return end;
    };
    return { core, started, settled, load, at };
}

describe('parallel', () => {
    it('flows run side by side: the run takes as long as the longest, not the sum', async () => {
        const { core, started, settled, load } = await setup();
        for (const f of ['a', 'b', 'c', 'd']) {
            core.add({ id: f + '1', type: 'work', ms: 100 }, f);
            core.add({ id: f + '2', type: 'work', ms: 200 }, f);
        }
        const end = await load();

        expect(Object.values(started)).toEqual(Array(8).fill(0));
        expect(settled).toMatchObject({ a1: 100, a2: 200, d1: 100, d2: 200 });
        expect(end).toBe(200);
    });

    it('a slow process holds neither the other flows nor what depends on its fast neighbours', async () => {
        const { core, started, load } = await setup();
        core.add({ id: 'slow', type: 'work', ms: 1000 }, 'one');
        core.add({ id: 'fast', type: 'work', ms: 50 }, 'one');
        core.add({ id: 'free', type: 'work', ms: 10 }, 'two');
        core.add({ id: 'after-fast', type: 'work', ms: 10, depends: ['fast'] }, 'three');
        const end = await load();

        expect(started).toMatchObject({ slow: 0, fast: 0, free: 0, 'after-fast': 50 });
        expect(end).toBe(1000);
    });
});

describe('released the moment they may run', () => {
    it('a dependency chain across flows: each starts when the one before it settles', async () => {
        const { core, started, load } = await setup();
        core.add({ id: 'a', type: 'work', ms: 100 }, 'f1');
        core.add({ id: 'b', type: 'work', ms: 50, depends: ['a'] }, 'f2');
        core.add({ id: 'c', type: 'work', ms: 30, depends: ['b'] }, 'f3');
        const end = await load();

        expect(started).toEqual({ a: 0, b: 100, c: 150 });
        expect(end).toBe(180);
    });

    it('several dependencies: when the last of them settles', async () => {
        const { core, started, load } = await setup();
        core.add({ id: 'x', type: 'work', ms: 40 });
        core.add({ id: 'y', type: 'work', ms: 90 });
        core.add({ id: 'z', type: 'fail', ms: 60 });
        core.add({ id: 'all', type: 'work', depends: ['x', 'y', 'z'] }, 'other');
        await load();

        expect(started.all).toBe(90);
    });

    it('an ordered flow: back to back, no gap between one and the next', async () => {
        const { core, started, load } = await setup();
        core.setFlowOptions({ ordered: true }, 'seq');
        core.add({ id: 'p1', type: 'work', ms: 100 }, 'seq');
        core.add({ id: 'p2', type: 'fail', ms: 50 }, 'seq');
        core.add({ id: 'p3', type: 'work', ms: 30 }, 'seq');
        const end = await load();

        expect(started).toEqual({ p1: 0, p2: 100, p3: 150 });
        expect(end).toBe(180);
    });

    it('a flow depending on another starts when its last process settles', async () => {
        const { core, started, load } = await setup();
        core.setFlowOptions({ depends: ['first'] }, 'second');
        core.add({ id: 'f1', type: 'work', ms: 100 }, 'first');
        core.add({ id: 'f2', type: 'work', ms: 250 }, 'first');
        core.add({ id: 's', type: 'work', ms: 10 }, 'second');
        const end = await load();

        expect(started.s).toBe(250);
        expect(end).toBe(260);
    });

    it('a trigger and dependencies: whichever comes last', async () => {
        const { core, started, load } = await setup();
        core.add({ id: 'dep', type: 'work', ms: 50 });
        core.add({ id: 'trigger-last', type: 'work', depends: ['dep'], trigger: (r) => setTimeout(r, 120) }, 'b');
        core.add({ id: 'deps-last', type: 'work', depends: ['dep'], trigger: (r) => setTimeout(r, 20) }, 'c');
        await load();

        expect(started).toMatchObject({ 'trigger-last': 120, 'deps-last': 50 });
    });

    it('a late flow starts the moment the regular flows are done', async () => {
        const { core, started, load } = await setup();
        core.registerType('adder', () => {
            core.add({ id: 'late', type: 'work', ms: 10 }, 'later');
            return sleep(20);
        });
        core.add({ id: 'adder', type: 'adder' }, 'a');
        core.add({ id: 'long', type: 'work', ms: 300 }, 'b');
        const end = await load();

        expect(started.late).toBe(300);
        expect(end).toBe(310);
    });

    it('a strict chain after a failure settles at once, without waiting for anything', async () => {
        const { core, settled, load } = await setup();
        core.add({ id: 'root', type: 'fail', ms: 70 });
        core.add({ id: 'next', type: 'work', ms: 500, depends: ['root'], strict: true }, 'b');
        core.add({ id: 'last', type: 'work', ms: 500, depends: ['next'], strict: true }, 'c');
        const end = await load();

        expect(settled).toEqual({ root: 70, next: 70, last: 70 });
        expect(end).toBe(70);
    });

    it('load() resolves when the last process settles, not later', async () => {
        const { core, settled, load } = await setup();
        core.add({ id: 'a', type: 'work', ms: 130 });
        core.add({ id: 'b', type: 'work', ms: 20 }, 'x');
        const end = await load();

        expect(end).toBe(settled.a);
    });
});

describe('waiting that is asked for, and only that', () => {
    it('delay and between: exactly as long as set', async () => {
        const { core, started, load } = await setup();
        core.setFlowOptions({ delay: 60, between: 40 }, 'f');
        core.add({ id: 'p1', type: 'work', ms: 10 }, 'f');
        core.add({ id: 'p2', type: 'work', ms: 10 }, 'f');
        core.add({ id: 'p3', type: 'work', ms: 10 }, 'f');
        await load();

        expect(started).toEqual({ p1: 60, p2: 100, p3: 140 });
    });

    it('between in an ordered flow counts from the end of the one before', async () => {
        const { core, started, load } = await setup();
        core.setFlowOptions({ ordered: true, between: 25 }, 'f');
        core.add({ id: 'p1', type: 'work', ms: 100 }, 'f');
        core.add({ id: 'p2', type: 'work', ms: 100 }, 'f');
        const end = await load();

        expect(started).toEqual({ p1: 0, p2: 125 });
        expect(end).toBe(225);
    });

    it('a timeout fails the process at its deadline, and what depends on it moves on then', async () => {
        const { core, started, settled, load } = await setup();
        core.add({ id: 'stuck', type: 'hang', timeout: 80 });
        core.add({ id: 'after', type: 'work', ms: 10, depends: ['stuck'] }, 'b');
        const end = await load();

        expect(settled.stuck).toBe(80);
        expect(started.after).toBe(80);
        expect(end).toBe(90);
    });

    it('retries wait retryDelay between attempts, and the timeout covers them all', async () => {
        const { core, settled, load } = await setup();
        const attempts = [];
        core.registerType('flaky', () => {
            attempts.push(Date.now());
            return sleep(10).then(() => { throw new Error('again'); });
        });
        core.add({ id: 'f', type: 'flaky', retries: 5, retryDelay: 30, timeout: 100 });
        await load();

        const first = attempts[0];
        expect(attempts.map((t) => t - first)).toEqual([0, 40, 80]);
        expect(settled.f).toBe(100);
    });
});
