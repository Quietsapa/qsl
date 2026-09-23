import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCore } from './helpers.js';
import triggers from '../src/plugins/triggers.js';

/**
 * The promises README.md and types/index.d.ts make, one test each, written
 * from the documents rather than from the code: exact values, and three or
 * more of a thing wherever two would not tell a right answer from a wrong
 * one. Each `describe` names the part of the README it holds to.
 */

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup({ fake = true } = {}) {
    if (fake) vi.useFakeTimers();
    const core = await freshCore();
    core.autoReset = false;
    core.yield = false;
    const t0 = Date.now();
    const at = () => Date.now() - t0;
    const log = [];
    const started = {};
    const signals = [];
    const name = (p) => p.id.replace(/^qsl-/, '');
    /**
     * No `ms`: done at once, not after a zero timer (which fake timers may
     * count as a millisecond).
     */
    const wait = (ms) => (ms ? sleep(ms) : Promise.resolve());
    core.registerType('work', (p) => wait(p.ms).then(() => { log.push(name(p)); }));
    core.registerType('fail', (p) => wait(p.ms).then(() => { throw new Error('fail ' + name(p)); }));
    core.registerType('hang', () => new Promise(() => {}));
    core.listeners.add((s) => {
        signals.push(s);
        if (s.type === 'PROCESS_STARTED') started[name(s.process)] = at();
    });
    const state = (id) => core.processStates.get('qsl-' + id);
    const reason = (id) => core._processIndex.get('qsl-' + id)?.skipReason ?? null;
    const errors = () => signals.filter((s) => s.level === 'error').map((s) => s.type);
    /**
     * start() begins the run without moving time; finish() moves time on
     * until it ends and returns the millisecond it ended at (null if it
     * never did). run() is both.
     */
    const start = (options) => {
        const ending = { at: null };
        core.load(options).then(() => { ending.at = at(); });
        return ending;
    };
    const finish = async (ending) => {
        for (let i = 0; i < 400 && ending.at === null; i++) {
            if (fake) await vi.advanceTimersByTimeAsync(5);
            else await sleep(5);
        }
        return ending.at;
    };
    const run = (options) => finish(start(options));
    return { core, log, started, signals, state, reason, errors, run, start, finish, at };
}

describe('Concepts: flows and processes', () => {
    it('no flow is the default flow; true is the ordered flow, which runs one after another', async () => {
        const { core, started, run } = await setup();
        core.add({ id: 'd1', type: 'work', ms: 50 });
        core.add({ id: 'o1', type: 'work', ms: 50 }, true);
        core.add({ id: 'o2', type: 'work', ms: 50 }, true);
        core.add({ id: 'o3', type: 'work', ms: 50 }, 'ordered');
        await run();

        expect(core._processIndex.get('qsl-d1').flowId).toBe('default');
        expect(started).toMatchObject({ d1: 0, o1: 0, o2: 50, o3: 100 });
    });

    it('a flow id that is a number is that number as a string', async () => {
        const { core, run } = await setup();
        core.add({ id: 'a', type: 'work' }, 7);
        core.setFlowOptions({ priority: 1 }, 7);
        await run();

        expect(core._processIndex.get('qsl-a').flowId).toBe('7');
        expect(core.flows.get('7').options.priority).toBe(1);
    });
});

describe('Concepts: conditions', () => {
    it('a process checks its condition when it starts, again after its trigger and dependencies, and again after its delay', async () => {
        const { core, state, reason, run } = await setup();
        let open = true;
        core.add({ id: 'dep', type: 'work', ms: 50 });
        core.add({ id: 'after-dep', type: 'work', depends: ['dep'], condition: () => open });
        core.add({ id: 'after-delay', type: 'work', delay: 100, condition: () => open }, 'b');
        setTimeout(() => { open = false; }, 30);
        await run();

        expect(state('after-dep')).toBe('skipped');
        expect(reason('after-dep')).toBe('condition');
        expect(state('after-delay')).toBe('skipped');
    });

    it('a flow checks its condition when it would start: a paused flow when it is released, not at load()', async () => {
        const { core, state, start, finish } = await setup();
        let consent = false;
        core.setFlowOptions({ paused: true, group: 'marketing', condition: () => consent }, 'm');
        core.add({ id: 'pixel', type: 'work' }, 'm');
        const ending = start();
        await vi.advanceTimersByTimeAsync(20);
        consent = true;
        core.runGroup('marketing');
        await finish(ending);

        expect(state('pixel')).toBe('completed');
    });

    it('a flow waiting for other flows checks its condition when they are done', async () => {
        const { core, state, run } = await setup();
        let open = true;
        core.add({ id: 'first', type: 'work', ms: 50 }, 'a');
        core.setFlowOptions({ depends: ['a'], condition: () => open }, 'b');
        core.add({ id: 'second', type: 'work' }, 'b');
        setTimeout(() => { open = false; }, 20);
        await run();

        expect(state('second')).toBe('skipped');
    });

    it('a flow checks its condition again after its delay', async () => {
        const { core, state, signals, run } = await setup();
        let open = true;
        core.setFlowOptions({ delay: 100, condition: () => open }, 'f');
        core.add({ id: 'x', type: 'work' }, 'f');
        setTimeout(() => { open = false; }, 50);
        await run();

        expect(state('x')).toBe('skipped');
        expect(signals.find((s) => s.type === 'FLOW_SKIPPED')).toMatchObject({ flow: 'f', args: ['condition'] });
        expect(signals.some((s) => s.type === 'FLOW_STARTED')).toBe(false);
    });

    it('an array of conditions: all must pass; or: one must; and: all must — on processes and flows', async () => {
        const { core, state, run } = await setup();
        core.add({ id: 'all-pass', type: 'work', condition: [true, () => true, true] });
        core.add({ id: 'all-one-fails', type: 'work', condition: [true, true, false] });
        core.add({ id: 'or-one-passes', type: 'work', condition: { operator: 'or', conditions: [false, false, true] } });
        core.add({ id: 'or-none-pass', type: 'work', condition: { operator: 'or', conditions: [false, false, false] } });
        core.add({ id: 'and-one-fails', type: 'work', condition: { operator: 'and', conditions: [true, false, true] } });
        core.setFlowOptions({ condition: [true, false] }, 'f');
        core.add({ id: 'in-failing-flow', type: 'work' }, 'f');
        await run();

        expect(['all-pass', 'all-one-fails', 'or-one-passes', 'or-none-pass', 'and-one-fails', 'in-failing-flow'].map(state))
            .toEqual(['completed', 'skipped', 'completed', 'skipped', 'skipped', 'skipped']);
    });

    it('a condition that throws, that is async, or whose handler throws fails, and is reported', async () => {
        const { core, state, errors, run } = await setup();
        core.conditionHandlers.add((c) => { if (c === 'explode') throw new Error('handler'); return null; });
        core.add({ id: 'throws', type: 'work', condition: () => { throw new Error('x'); } });
        core.add({ id: 'async', type: 'work', condition: async () => true });
        core.add({ id: 'handler', type: 'work', condition: 'explode' });
        core.setFlowOptions({ condition: 'explode' }, 'f');
        core.add({ id: 'flow', type: 'work' }, 'f');
        expect(await run()).not.toBeNull();

        expect(['throws', 'async', 'handler', 'flow'].map(state)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
        expect(errors().filter((e) => e === 'CONDITION_FAILED').length).toBeGreaterThanOrEqual(4);
    });

    it('a condition nothing knows is reported and passes', async () => {
        const { core, state, errors, run } = await setup();
        core.add({ id: 'a', type: 'work', condition: 'weather:sunny' });
        core.add({ id: 'b', type: 'work', condition: { operator: 'xor', conditions: [false] } });
        await run();

        expect([state('a'), state('b')]).toEqual(['completed', 'completed']);
        expect(errors().filter((e) => e === 'UNKNOWN_CONDITION')).toHaveLength(2 * 2);
    });
});

describe('Concepts: triggers', () => {
    it('an array of triggers waits for every one, each counted once however often it fires', async () => {
        const { core, started, run } = await setup();
        const noisy = (r) => { r(); r(); r(); };
        core.add({ id: 'all', type: 'work', trigger: [noisy, (r) => setTimeout(r, 40), (r) => setTimeout(r, 90)] });
        core.setFlowOptions({ trigger: [noisy, (r) => setTimeout(r, 60)] }, 'f');
        core.add({ id: 'flow', type: 'work' }, 'f');
        core.add({ id: 'and', type: 'work', trigger: { operator: 'and', triggers: [noisy, (r) => setTimeout(r, 70)] } }, 'g');
        await run();

        expect(started).toEqual({ all: 90, flow: 60, and: 70 });
    });

    it('or fires with the first, once', async () => {
        const { core, started, signals, run } = await setup();
        core.add({ id: 'or', type: 'work', trigger: { operator: 'or', triggers: [(r) => setTimeout(r, 80), (r) => setTimeout(r, 30), (r) => setTimeout(r, 50)] } });
        await run();

        expect(started.or).toBe(30);
        expect(signals.filter((s) => s.type === 'PROCESS_TRIGGERED')).toHaveLength(1);
    });

    it('a trigger whose handler throws is reported and fires, on a process and on a flow', async () => {
        const { core, state, errors, run } = await setup();
        core.triggerHandlers.add((t) => (t === 'broken' ? () => { throw new Error('x'); } : null));
        core.add({ id: 'p', type: 'work', trigger: 'broken' });
        core.setFlowOptions({ trigger: 'broken' }, 'f');
        core.add({ id: 'q', type: 'work' }, 'f');
        await run();

        expect([state('p'), state('q')]).toEqual(['completed', 'completed']);
        expect(errors().filter((e) => e === 'TRIGGER_FAILED')).toHaveLength(2);
    });

    it('a trigger nothing knows is reported and does not hold anything back', async () => {
        const { core, started, errors, run } = await setup();
        core.add({ id: 'typo', type: 'work', trigger: 'idel' });
        core.add({ id: 'op', type: 'work', trigger: { operator: 'xor', triggers: ['idle'] } });
        await run();

        expect(started).toEqual({ typo: 0, op: 0 });
        expect(errors().filter((e) => e === 'UNKNOWN_TRIGGER')).toHaveLength(2);
    });

    it('a process trigger is armed when its turn comes, and flows with a trigger start after the others', async () => {
        const { core, log, run } = await setup();
        core.setFlowOptions({ trigger: (r) => r(), priority: 10 }, 'triggered');
        core.setFlowOptions({ priority: 1 }, 'low');
        core.setFlowOptions({ priority: 5 }, 'high');
        core.add({ id: 't', type: 'work' }, 'triggered');
        core.add({ id: 'l', type: 'work' }, 'low');
        core.add({ id: 'h', type: 'work' }, 'high');
        await run();

        expect(log).toEqual(['h', 'l', 't']);
    });

    it('the media trigger fires at once without a query or without matchMedia', async () => {
        const { core, state, run } = await setup();
        core.use(triggers);
        vi.stubGlobal('matchMedia', undefined);
        core.add({ id: 'a', type: 'work', trigger: 'media:' });
        core.add({ id: 'b', type: 'work', trigger: 'media:(min-width: 1px)' });
        await run();

        expect([state('a'), state('b')]).toEqual(['completed', 'completed']);
    });
});

describe('Concepts: dependencies', () => {
    it('depends may be one id rather than a list, for processes and flows', async () => {
        const { core, started, run } = await setup();
        core.add({ id: 'a', type: 'work', ms: 40 });
        core.add({ id: 'b', type: 'work', depends: 'a' }, 'x');
        core.setFlowOptions({ depends: 'x' }, 'y');
        core.add({ id: 'c', type: 'work' }, 'y');
        await run();

        expect(started).toEqual({ a: 0, b: 40, c: 40 });
    });

    it('a flow depending on flows that exist and one that does not waits for the ones that exist, and runs', async () => {
        const { core, started, errors, run } = await setup();
        core.add({ id: 'a', type: 'work', ms: 50 }, 'one');
        core.add({ id: 'b', type: 'work', ms: 80 }, 'two');
        core.setFlowOptions({ depends: ['one', 'ghost', 'two'] }, 'three');
        core.add({ id: 'c', type: 'work' }, 'three');
        await run();

        expect(started.c).toBe(80);
        expect(errors()).toEqual(['DEP_NOT_FOUND']);
    });

    it('strict flows skip for a missing flow, a skipped one, or one with a failure inside', async () => {
        const { core, state, run } = await setup();
        core.add({ id: 'bad', type: 'fail' }, 'failing');
        core.setFlowOptions({ condition: false }, 'off');
        core.add({ id: 'never', type: 'work' }, 'off');
        core.add({ id: 'good', type: 'work' }, 'fine');
        for (const [flow, dep] of [['s1', 'ghost'], ['s2', 'off'], ['s3', 'failing'], ['s4', 'fine']]) {
            core.setFlowOptions({ depends: [dep], strict: true }, flow);
            core.add({ id: flow + 'p', type: 'work' }, flow);
        }
        await run();

        expect(['s1p', 's2p', 's3p', 's4p'].map(state)).toEqual(['skipped', 'skipped', 'skipped', 'completed']);
    });

    it('setting depends on a flow that has already started changes nothing about it', async () => {
        const { core, state, signals, start, finish } = await setup();
        core.add({ id: 'a', type: 'work', ms: 100 }, 'f');
        const ending = start();
        await vi.advanceTimersByTimeAsync(20);
        core.setFlowOptions({ depends: ['ghost'] }, 'f');
        await finish(ending);

        expect(state('a')).toBe('completed');
        expect(signals.filter((s) => s.type === 'ALL_COMPLETED')).toHaveLength(1);
        expect(signals.some((s) => s.type === 'FLOW_SKIPPED')).toBe(false);
    });

    it('an empty depends list stops a flow waiting', async () => {
        const { core, state, run } = await setup();
        core.setFlowOptions({ depends: ['ghost'], strict: true }, 'f');
        core.setFlowOptions({ depends: [] }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        await run();

        expect(state('a')).toBe('completed');
    });

    it('two processes of one run with the same id are reported', async () => {
        const { core, errors, run } = await setup();
        core.add({ id: 'twin', type: 'work' }, 'a');
        core.add({ id: 'twin', type: 'work' }, 'b');
        await run();

        expect(errors()).toEqual(['DUPLICATE_ID']);
    });
});

describe('Concepts: outcome and strict', () => {
    it('the nearest strict wins: process over flow over instance', async () => {
        const { core, state, run } = await setup();
        core.strict = true;
        core.add({ id: 'root', type: 'fail' });
        core.setFlowOptions({ strict: false }, 'loose');
        core.add({ id: 'inherits-flow', type: 'work', depends: ['root'] }, 'loose');
        core.add({ id: 'own-strict', type: 'work', depends: ['root'], strict: true }, 'loose');
        core.add({ id: 'inherits-instance', type: 'work', depends: ['root'] }, 'plain');
        core.add({ id: 'own-loose', type: 'work', depends: ['root'], strict: false }, 'plain');
        await run();

        expect(['inherits-flow', 'own-strict', 'inherits-instance', 'own-loose'].map(state))
            .toEqual(['completed', 'skipped', 'skipped', 'completed']);
    });

    it('a strict ordered chain: broken by a failure, a timeout or a circular skip; not by a skip for its own condition', async () => {
        const { core, state, reason, run } = await setup();
        core.setFlowOptions({ ordered: true, strict: true }, 'chain');
        core.add({ id: 'c1', type: 'work', priority: 5 }, 'chain');
        core.add({ id: 'c2', type: 'work', priority: 4, condition: false }, 'chain');
        core.add({ id: 'c3', type: 'work', priority: 3 }, 'chain');
        core.add({ id: 'c4', type: 'work', priority: 2, depends: ['c4'] }, 'chain');
        core.add({ id: 'c5', type: 'work', priority: 1 }, 'chain');
        core.add({ id: 'c6', type: 'work', priority: 0, condition: false }, 'chain');
        core.add({ id: 'c7', type: 'work', priority: -1, strict: false }, 'chain');
        core.add({ id: 'c8', type: 'work', priority: -2 }, 'chain');
        await run();

        expect(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((id) => [state(id), reason(id)])).toEqual([
            ['completed', null],
            ['skipped', 'condition'],
            ['completed', null],
            ['skipped', 'circular'],
            ['skipped', 'dependency'],
            ['skipped', 'condition'],
            ['completed', null],
            ['completed', null],
        ]);
    });

    it('a strict ordered chain after a timeout skips the rest', async () => {
        const { core, state, run } = await setup();
        core.setFlowOptions({ ordered: true, strict: true, timeout: 50 }, 'chain');
        core.add({ id: 'a', type: 'hang', priority: 3 }, 'chain');
        core.add({ id: 'b', type: 'work', priority: 2 }, 'chain');
        core.add({ id: 'c', type: 'work', priority: 1 }, 'chain');
        await run();

        expect(['a', 'b', 'c'].map(state)).toEqual(['failed', 'skipped', 'skipped']);
    });
});

describe('Concepts: timeout and retries', () => {
    it('the nearest timeout, retries and retryDelay win: process over flow over instance, 0 turning the timeout off', async () => {
        const { core, state, run, signals } = await setup();
        core.timeout = 30;
        core.retries = 1;
        core.setFlowOptions({ timeout: 60, retries: 2, retryDelay: 5 }, 'f');
        core.add({ id: 'instance', type: 'hang' });
        core.add({ id: 'flow', type: 'hang' }, 'f');
        core.add({ id: 'own', type: 'hang', timeout: 90 }, 'f');
        core.add({ id: 'off', type: 'work', ms: 150, timeout: 0 }, 'f');
        const failedAt = {};
        core.listeners.add(function (s) { if (s.type === 'PROCESS_FAILED') failedAt[s.process.id] = Date.now(); });
        const t0 = Date.now();
        core.registerType('flaky', () => Promise.reject(new Error('x')));
        core.add({ id: 'retried', type: 'flaky' }, 'f');
        core.add({ id: 'retried-instance', type: 'flaky' });
        await run();

        expect(failedAt['qsl-instance'] - t0).toBe(30);
        expect(failedAt['qsl-flow'] - t0).toBe(60);
        expect(failedAt['qsl-own'] - t0).toBe(90);
        expect(state('off')).toBe('completed');
        const retries = (id) => signals.filter((s) => s.type === 'PROCESS_RETRY' && s.process.id === 'qsl-' + id).length;
        expect([retries('retried'), retries('retried-instance')]).toEqual([2, 1]);
    });

    it('a timeout counts from the start of loading: trigger, dependencies and the process delay are not part of it', async () => {
        const { core, state, run } = await setup();
        core.add({ id: 'dep', type: 'work', ms: 100 });
        core.add({ id: 'waits', type: 'work', ms: 40, timeout: 50, depends: ['dep'], trigger: (r) => setTimeout(r, 150), delay: 200 }, 'b');
        await run();

        expect(state('waits')).toBe('completed');
    });

    it('onError comes once, for the final outcome; late callbacks from the handler after a timeout are dropped', async () => {
        const { core, run } = await setup();
        const calls = [];
        core.registerType('late', (p) => sleep(100).then(() => { p.onError?.(new Error('late error')); p.onComplete?.(); }));
        core.add({ id: 'x', type: 'late', timeout: 50, onError: (e) => calls.push('error ' + e.name), onComplete: () => calls.push('complete') });
        await run();
        await vi.advanceTimersByTimeAsync(200);

        expect(calls).toEqual(['error TimeoutError']);
    });

    it('onBeforeStart and the process delay happen once, before the first attempt, for any type', async () => {
        const { core, run } = await setup();
        const seen = [];
        let attempts = 0;
        core.registerType('custom', () => {
            seen.push('attempt ' + Date.now());
            return ++attempts < 3 ? Promise.reject(new Error('again')) : undefined;
        });
        const t0 = Date.now();
        core.add({ id: 'x', type: 'custom', retries: 2, delay: 70, onBeforeStart: () => seen.push('before ' + (Date.now() - t0)) });
        await run();

        expect(seen.map((s) => s.replace(/\d{6,}/, (n) => String(n - t0)))).toEqual(['before 70', 'attempt 70', 'attempt 70', 'attempt 70']);
    });

    it('onBeforeStart is awaited, and one that throws fails the process with onError', async () => {
        const { core, state, started, run } = await setup();
        const errors = [];
        core.add({ id: 'waits', type: 'work', onBeforeStart: () => sleep(60) });
        core.add({ id: 'throws', type: 'work', onBeforeStart: () => { throw new Error('nope'); }, onError: (e) => errors.push(e.message) }, 'b');
        await run();

        expect(started.waits).toBe(60);
        expect(state('throws')).toBe('failed');
        expect(errors).toEqual(['nope']);
    });

    it('an unknown type fails the process and calls its onError', async () => {
        const { core, state, run } = await setup();
        const errors = [];
        core.add({ id: 'x', type: 'carousel', onError: (e) => errors.push(e.message) });
        await run();

        expect(state('x')).toBe('failed');
        expect(errors).toEqual(['Unknown type: carousel']);
    });
});

describe('API: load()', () => {
    it('called again during a run, returns a promise that resolves with that run', async () => {
        const { core, start, finish, at } = await setup();
        core.add({ id: 'a', type: 'work', ms: 100 });
        let second = null;
        const ending = start();
        await vi.advanceTimersByTimeAsync(10);
        core.load().then(() => { second = at(); });
        expect(await finish(ending)).toBe(100);
        expect(second).toBe(100);
    });

    it('an empty run completes like any other: ALL_COMPLETED, onAllComplete', async () => {
        const { core, signals, run } = await setup();
        const calls = [];
        core.setOnAllComplete(() => calls.push('onAllComplete'));
        expect(await run()).toBe(0);

        expect(calls).toEqual(['onAllComplete']);
        expect(signals.map((s) => s.type)).toEqual(['LOAD', 'ALL_COMPLETED']);
    });

    it('options.between staggers every flow that sets none of its own', async () => {
        const { core, started, run } = await setup();
        for (const id of ['a', 'b', 'c']) core.add({ id, type: 'work' }, 'f');
        core.setFlowOptions({ between: 0 }, 'own');
        for (const id of ['x', 'y', 'z']) core.add({ id, type: 'work' }, 'own');
        await run({ between: 25 });

        expect(started).toEqual({ a: 0, b: 25, c: 50, x: 0, y: 0, z: 0 });
    });
});

describe('API: flow options', () => {
    it('delay: the flow starts after it; onBeforeStart and FLOW_STARTED come then', async () => {
        const { core, started, signals, run } = await setup();
        const before = [];
        core.setFlowOptions({ delay: 80, onBeforeStart: () => before.push(Date.now()) }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        const t0 = Date.now();
        core.listeners.add((s) => { if (s.type === 'FLOW_STARTED') before.push('signal ' + (Date.now() - t0)); });
        await run();

        expect(started.a).toBe(80);
        expect(before.map((b) => (typeof b === 'number' ? b - t0 : b))).toEqual([80, 'signal 80']);
        expect(signals.filter((s) => s.type === 'FLOW_STARTED')).toHaveLength(1);
    });

    it('priority orders the processes of a flow, higher first, ordered or not', async () => {
        const { core, log, run } = await setup();
        core.setFlowOptions({ ordered: true }, 'seq');
        core.add({ id: 'low', type: 'work', priority: -1 }, 'seq');
        core.add({ id: 'mid', type: 'work' }, 'seq');
        core.add({ id: 'top', type: 'work', priority: 3 }, 'seq');
        core.setFlowOptions({ between: 10 }, 'par');
        core.add({ id: 'p-low', type: 'work', priority: 1 }, 'par');
        core.add({ id: 'p-top', type: 'work', priority: 9 }, 'par');
        core.add({ id: 'p-mid', type: 'work', priority: 5 }, 'par');
        await run();

        expect(log.filter((x) => !x.startsWith('p-'))).toEqual(['top', 'mid', 'low']);
        expect(log.filter((x) => x.startsWith('p-'))).toEqual(['p-top', 'p-mid', 'p-low']);
    });

    it('onComplete of a flow runs once it has ended', async () => {
        const { core, run } = await setup();
        const done = [];
        core.setFlowOptions({ onComplete: () => done.push(Date.now()) }, 'f');
        core.add({ id: 'a', type: 'work', ms: 30 }, 'f');
        core.add({ id: 'b', type: 'work', ms: 70 }, 'f');
        const t0 = Date.now();
        await run();

        expect(done.map((t) => t - t0)).toEqual([70]);
    });

    it('preload: a link per script and stylesheet without a trigger, with crossOrigin and fetchpriority; none for a flow with a trigger', async () => {
        const { core, run } = await setup();
        core.registerType('script', () => {});
        core.registerType('stylesheet', () => {});
        core.setFlowOptions({ preload: true }, 'f');
        core.add({ id: 's1', type: 'script', src: '/one.js', crossOrigin: 'anonymous', fetchPriority: 'low' }, 'f');
        core.add({ id: 's2', type: 'stylesheet', href: '/two.css' }, 'f');
        core.add({ id: 's3', type: 'script', src: '/three.js', trigger: (r) => r() }, 'f');
        core.setFlowOptions({ preload: true, trigger: (r) => r() }, 'g');
        core.add({ id: 's4', type: 'script', src: '/four.js' }, 'g');
        await run();

        const links = [...document.querySelectorAll('link[rel=preload]')].map((l) => [l.getAttribute('href'), l.getAttribute('as'), l.getAttribute('crossorigin'), l.getAttribute('fetchpriority')]);
        expect(links).toEqual([['/one.js', 'script', 'anonymous', 'low'], ['/two.css', 'style', null, null]]);
        document.head.innerHTML = '';
    });
});

describe('API: runFlow, pauseGroup, runGroup', () => {
    it('runFlow() before load() only lifts the pause: the flow starts with the others, and later adds still run', async () => {
        const { core, state, started, run } = await setup();
        core.setFlowOptions({ paused: true }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        core.runFlow('f');
        core.add({ id: 'b', type: 'work' }, 'f');
        expect(core.flows.get('f').phase).toBe('ready');
        await run();

        expect([state('a'), state('b')]).toEqual(['completed', 'completed']);
        expect(started).toEqual({ a: 0, b: 0 });
    });

    it('runFlow(id, true) starts a flow without waiting for its trigger; runFlow(id) waits for it', async () => {
        const { core, started, start, finish } = await setup();
        core.setFlowOptions({ paused: true, trigger: (r) => setTimeout(r, 100) }, 'skip-trigger');
        core.setFlowOptions({ paused: true, trigger: (r) => setTimeout(r, 100) }, 'keep-trigger');
        core.add({ id: 'a', type: 'work' }, 'skip-trigger');
        core.add({ id: 'b', type: 'work' }, 'keep-trigger');
        const ending = start();
        await vi.advanceTimersByTimeAsync(20);
        core.runFlow('skip-trigger', true);
        core.runFlow('keep-trigger');
        await finish(ending);

        expect(started.a).toBe(20);
        expect(started.b).toBe(120);
    });

    it('pauseGroup holds a flow waiting for its trigger; one fired during the pause waits for it afresh after runGroup', async () => {
        const { core, started, start, finish } = await setup();
        let fire;
        core.setFlowOptions({ group: 'g', trigger: (r) => { fire = r; } }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        const ending = start();
        await vi.advanceTimersByTimeAsync(10);
        core.pauseGroup('g');
        fire();
        await vi.advanceTimersByTimeAsync(10);
        expect(started.a).toBeUndefined();
        core.runGroup('g');
        await vi.advanceTimersByTimeAsync(10);
        expect(started.a).toBeUndefined();
        fire();
        await finish(ending);

        expect(started.a).toBe(30);
    });

    it('inGroup lists the flows whose group is that group now', async () => {
        const { core } = await setup();
        core.setFlowOptions({ group: 'g' }, 'a');
        core.setFlowOptions({ group: 'g' }, 'b');
        core.setFlowOptions({ group: 'h' }, 'c');
        core.setFlowOptions({ group: 'h' }, 'b');

        expect(core.inGroup('g')).toEqual(['a']);
        expect(core.inGroup('h')).toEqual(['b', 'c']);
    });
});

describe('Concepts: late adds', () => {
    it('a process added to a started flow runs in a late flow that carries condition, strict, timeout, retries, retryDelay, fireEvents and group', async () => {
        const { core, start, finish } = await setup();
        const options = { strict: true, timeout: 77, retries: 2, retryDelay: 9, fireEvents: false, group: 'g', condition: true };
        core.setFlowOptions(options, 'f');
        core.add({ id: 'first', type: 'work', ms: 50 }, 'f');
        const ending = start();
        await vi.advanceTimersByTimeAsync(10);
        core.add({ id: 'late', type: 'work' }, 'f');
        await finish(ending);

        const lateFlow = core._processIndex.get('qsl-late').flowId;
        expect(lateFlow).toMatch(/^f\+late-/);
        expect(core.flows.get(lateFlow).options).toMatchObject(options);
    });

    it('a late flow added while another late flow waits for its trigger starts at once', async () => {
        const { core, started, start, finish } = await setup();
        let release;
        core.registerType('adder', () => {
            core.setFlowOptions({ trigger: (r) => { release = r; } }, 'held');
            core.add({ id: 'held-p', type: 'work' }, 'held');
            return sleep(50);
        });
        core.add({ id: 'a', type: 'adder' });
        const ending = start();
        await vi.advanceTimersByTimeAsync(60);
        core.add({ id: 'next', type: 'work' }, 'next');
        await vi.advanceTimersByTimeAsync(10);
        expect(started.next).toBe(60);
        expect(started['held-p']).toBeUndefined();
        release();
        await finish(ending);

        expect(started['held-p']).toBe(70);
    });

    it('a process added while the run completes, or after it with autoReset off, goes into the next run', async () => {
        const { core, state, run } = await setup();
        core.setOnAllComplete(() => core.add({ id: 'from-callback', type: 'work' }));
        core.add({ id: 'a', type: 'work' });
        await run();
        core.add({ id: 'after', type: 'work' });
        expect(state('from-callback')).toBeUndefined();

        core.reset();
        core.setOnAllComplete(null);
        await run();
        expect([state('from-callback'), state('after')]).toEqual(['completed', 'completed']);
    });
});

describe('between at every level', () => {
    const gaps = async (setupRun) => {
        const core = await freshCore();
        core.autoReset = false;
        const at = [];
        core.registerType('mark', () => { at.push(Date.now()); });
        const t0 = Date.now();
        await setupRun(core);
        return at.map((t) => Math.round((t - t0) / 10) * 10);
    };
    const three = (core, flow = 'f') => { for (const id of ['a', 'b', 'c']) core.add({ id, type: 'mark' }, flow); };

    it('qsl.between applies to every flow without its own, and stays across runs', async () => {
        vi.useFakeTimers();
        try {
            let core;
            const first = gaps(async (c) => { core = c; c.between = 100; three(c); await Promise.all([c.load(), vi.advanceTimersByTimeAsync(500)]); });
            expect(await first).toEqual([0, 100, 200]);
            core.reset();
            expect(core.between).toBe(100);
        } finally {
            vi.useRealTimers();
        }
    });

    it('load({ between }) takes its place for one run; a flow\'s own between wins over both', async () => {
        vi.useFakeTimers();
        try {
            const run = await gaps(async (c) => {
                c.between = 100;
                three(c, 'f');
                c.setFlowOptions({ between: 10 }, 'own');
                for (const id of ['x', 'y']) c.add({ id, type: 'mark' }, 'own');
                await Promise.all([c.load({ between: 50 }), vi.advanceTimersByTimeAsync(500)]);
            });
            expect(run.sort((a, b) => a - b)).toEqual([0, 0, 10, 50, 100]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('API: reset(), onAllComplete, hooks', () => {
    it('reset() during a run lets load() resolve, and nothing of that run leaks into the next', async () => {
        const { core, state, started, start, finish } = await setup();
        core.add({ id: 'x', type: 'work', ms: 100 }, 'f');
        core.setFlowOptions({ trigger: (r) => setTimeout(r, 50) }, 'g');
        core.add({ id: 'g1', type: 'work' }, 'g');
        let first = 'pending';
        core.load().then(() => { first = 'resolved'; });
        await vi.advanceTimersByTimeAsync(10);
        core.reset();
        await vi.advanceTimersByTimeAsync(0);
        expect(first).toBe('resolved');

        core.add({ id: 'x', type: 'work', ms: 300 }, 'h');
        core.add({ id: 'y', type: 'work', depends: ['x'] }, 'h2');
        core.setFlowOptions({ trigger: (r) => setTimeout(r, 1000) }, 'g');
        core.add({ id: 'g2', type: 'work' }, 'g');
        const ending = start();
        await vi.advanceTimersByTimeAsync(200);
        expect(state('x')).toBeUndefined();
        expect(started.g2).toBeUndefined();
        await finish(ending);

        expect(core.flows.has('f')).toBe(false);
        expect(started.y).toBeGreaterThanOrEqual(300 + 10);
    });

    it('onAllComplete that throws is reported, the run still resolves, and the next run completes too', async () => {
        const { core, errors, run } = await setup();
        core.setOnAllComplete(() => { throw new Error('x'); });
        core.autoReset = true;
        core.add({ id: 'a', type: 'work' });
        expect(await run()).not.toBeNull();
        core.add({ id: 'b', type: 'work' });
        expect(await run()).not.toBeNull();

        expect(errors()).toEqual(['CALLBACK_FAILED', 'CALLBACK_FAILED']);
    });

    it('plugin hooks that throw are reported and do not stop the run', async () => {
        const { core, state, errors, run } = await setup();
        const boom = () => { throw new Error('hook'); };
        for (const set of ['listeners', 'handlerCallbacksFilters', 'conditionHandlers', 'triggerHandlers']) {
            core[set].add(boom);
        }
        core.add({ id: 'a', type: 'work' });
        core.add({ id: 'b', type: 'work', depends: ['a'] }, 'other');
        expect(await run()).not.toBeNull();

        expect([state('a'), state('b')]).toEqual(['completed', 'completed']);
        expect(errors().every((e) => e === 'CALLBACK_FAILED' || e === 'LISTENER_FAILED')).toBe(true);
    });

});

describe('Events and messages', () => {
    it('only process signals and the end of the run become QSL:* events', async () => {
        const { core, run } = await setup();
        const seen = [];
        const fn = (e) => seen.push(e.type);
        for (const name of ['started', 'completed', 'skipped', 'error', 'all:completed']) window.addEventListener('QSL:' + name, fn);
        core.add({ id: 'm', message: 'SKIPPED' });
        core.emit('STARTED', 'info', null);
        await run();
        for (const name of ['started', 'completed', 'skipped', 'error', 'all:completed']) window.removeEventListener('QSL:' + name, fn);

        expect(seen).toEqual(['QSL:started', 'QSL:completed', 'QSL:all:completed']);
    });

    it('a console process reports its message as MESSAGE', async () => {
        const { core, signals, run } = await setup();
        core.add({ id: 'm', message: 'hello' });
        await run();

        expect(signals.find((s) => s.type === 'MESSAGE')).toMatchObject({ args: ['hello'] });
        expect(signals.find((s) => s.type === 'MESSAGE').process.id).toBe('qsl-m');
    });
});

describe('Second reading: moments where the run changes under a callback', () => {
    it('a trigger handler that throws while resolving is reported and fires, and load() does not throw', async () => {
        const { core, state, errors, run } = await setup();
        core.triggerHandlers.add((t) => { if (t === 'bad') throw new Error('parse'); return null; });
        core.setFlowOptions({ trigger: 'bad' }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        core.add({ id: 'b', type: 'work', trigger: 'bad' });
        expect(await run()).not.toBeNull();

        expect([state('a'), state('b')]).toEqual(['completed', 'completed']);
        expect(errors().filter((e) => e === 'TRIGGER_FAILED')).toHaveLength(2);
    });

    it('a flow whose trigger has fired is not armed again when it is given flows to wait for', async () => {
        const { core, started, start, finish } = await setup();
        let armed = 0;
        let release;
        core.setFlowOptions({ trigger: (r) => { armed++; release = r; } }, 't');
        core.add({ id: 't1', type: 'work' }, 't');
        core.add({ id: 'g1', type: 'work', ms: 100 }, 'g');
        const ending = start();
        await vi.advanceTimersByTimeAsync(10);
        core.setFlowOptions({ depends: ['g'] }, 't');
        release();
        await finish(ending);

        expect(armed).toBe(1);
        expect(started.t1).toBe(100);
    });

    it('inside onAllComplete, options, adds and load() all belong to the next run', async () => {
        const { core, started, signals } = await setup();
        core.autoReset = true;
        let loadedAgain = null;
        core.setOnAllComplete(() => {
            if (core._processIndex.has('qsl-n1') || loadedAgain) return;
            core.setFlowOptions({ ordered: true }, 'next');
            core.add({ id: 'n1', type: 'work', ms: 30 }, 'next');
            core.add({ id: 'n2', type: 'work', ms: 30 }, 'next');
            loadedAgain = core.load();
        });
        core.add({ id: 'a', type: 'work', ms: 10 });
        core.load();
        await vi.advanceTimersByTimeAsync(200);
        await loadedAgain;

        expect(started).toEqual({ a: 0, n1: 10, n2: 40 });
        expect(signals.filter((s) => s.type === 'ALL_COMPLETED')).toHaveLength(2);
    });

    it('reset() and a new run from onAllComplete are not undone by the completion', async () => {
        const { core, started } = await setup();
        core.autoReset = true;
        let once = false;
        core.setOnAllComplete(() => {
            if (once) return;
            once = true;
            core.reset();
            core.add({ id: 'next', type: 'work', ms: 20 });
            core.load();
        });
        core.add({ id: 'a', type: 'work' });
        core.load();
        await vi.advanceTimersByTimeAsync(100);

        expect(started).toEqual({ a: 0, next: 0 });
    });

    it('after reset(), a run cut short calls no handler and no onError, and its ordered chain stops', async () => {
        const { core, log, signals, start } = await setup();
        const onError = vi.fn();
        const condition = vi.fn(() => true);
        core.add({ id: 'prep', type: 'work', onBeforeStart: () => sleep(100) });
        core.add({ id: 'stuck', type: 'hang', timeout: 50, onError }, 'b');
        core.setFlowOptions({ ordered: true }, 'chain');
        core.add({ id: 'c1', type: 'work', ms: 40 }, 'chain');
        core.add({ id: 'c2', type: 'work', condition }, 'chain');
        start();
        await vi.advanceTimersByTimeAsync(10);
        const before = signals.length;
        core.reset();
        await vi.advanceTimersByTimeAsync(300);

        expect(log).toEqual(['c1']);
        expect(onError).not.toHaveBeenCalled();
        expect(condition).not.toHaveBeenCalled();
        expect(signals.slice(before).map((s) => s.type)).toEqual(['RESET']);
    });

    it('pauseGroup during a flow\'s delay holds it; runGroup starts it, delay and all', async () => {
        const { core, started, start, finish } = await setup();
        core.setFlowOptions({ group: 'm', delay: 100 }, 'm');
        core.add({ id: 'a', type: 'work' }, 'm');
        const ending = start();
        await vi.advanceTimersByTimeAsync(50);
        core.pauseGroup('m');
        await vi.advanceTimersByTimeAsync(150);
        expect(started.a).toBeUndefined();
        core.runGroup('m');
        await finish(ending);

        expect(started.a).toBe(300);
    });

    it('destroy() drops processes waiting for the next run', async () => {
        const { core, run } = await setup();
        core.add({ id: 'a', type: 'work' });
        await run();
        core.add({ id: 'queued', type: 'work' });
        core.destroy();

        expect(core.flows.size).toBe(0);
    });

    it('flow 0 during a run is flow "0", like before it', async () => {
        const { core, start, finish } = await setup();
        core.setFlowOptions({ paused: true }, 0);
        core.add({ id: 'a', type: 'work' }, 0);
        const ending = start();
        core.add({ id: 'b', type: 'work' }, 0);
        core.runFlow(0);
        await finish(ending);

        expect(core.flows.get('0').processes.map((p) => p.id)).toEqual(['qsl-a', 'qsl-b']);
    });

    it('a callback or hook that rejects is reported, like one that throws', async () => {
        const { core, state, errors, run } = await setup();
        core.setFlowOptions({ onBeforeStart: async () => { throw new Error('later'); } }, 'f');
        core.handlerCallbacksFilters.add(() => Promise.reject(new Error('hook')));
        core.add({ id: 'a', type: 'work' }, 'f');
        await run();
        await vi.advanceTimersByTimeAsync(0);

        expect(state('a')).toBe('completed');
        expect(errors()).toEqual(['CALLBACK_FAILED', 'CALLBACK_FAILED']);
    });

});

describe('Third reading: completion and pauses within a delay', () => {
    it('ALL_COMPLETED carries how each process ended, and comes once the run is cleared', async () => {
        const { core, signals, run } = await setup();
        core.autoReset = true;
        core.add({ id: 'a', type: 'work' });
        core.add({ id: 'b', type: 'fail' });
        let sizeThen = null;
        core.listeners.add(function ({ type }) { if (type === 'ALL_COMPLETED') sizeThen = this.processStates.size; });
        await run();

        expect(signals.find((s) => s.type === 'ALL_COMPLETED').args[0]).toEqual(new Map([['qsl-a', 'completed'], ['qsl-b', 'failed']]));
        expect(sizeThen).toBe(0);
    });

    it('from an ALL_COMPLETED listener, add(), setFlowOptions(), reset() and load() set up and start the next run', async () => {
        const { core, started, state } = await setup();
        core.autoReset = true;
        let round = 0;
        core.listeners.add(function ({ type }) {
            if (type !== 'ALL_COMPLETED' || round++) return;
            this.reset();
            this.setFlowOptions({ ordered: true }, 'n');
            this.add({ id: 'n1', type: 'work', ms: 20 }, 'n');
            this.add({ id: 'n2', type: 'work', ms: 20 }, 'n');
            this.load();
        });
        core.add({ id: 'a', type: 'work', ms: 10 });
        core.load();
        await vi.advanceTimersByTimeAsync(200);

        expect(started).toEqual({ a: 0, n1: 10, n2: 30 });
    });

    it('pauseGroup then runGroup within one delay: the flow goes on as planned', async () => {
        const { core, started, run } = await setup();
        core.setFlowOptions({ group: 'g', delay: 100 }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        setTimeout(() => core.pauseGroup('g'), 20);
        setTimeout(() => core.runGroup('g'), 40);

        expect(await run()).toBe(100);
        expect(started.a).toBe(100);
    });

    it('a late flow paused in its delay does not hold up the late flows after it', async () => {
        const { core, started, start, finish } = await setup();
        core.registerType('adder', () => {
            core.setFlowOptions({ group: 'g', delay: 100 }, 'l1');
            core.add({ id: 'l1p', type: 'work' }, 'l1');
            core.add({ id: 'l2p', type: 'work' }, 'l2');
            return sleep(10);
        });
        core.add({ id: 'r', type: 'adder' });
        const ending = start();
        await vi.advanceTimersByTimeAsync(20);
        core.pauseGroup('g');
        await vi.advanceTimersByTimeAsync(150);
        expect(started.l2p).toBe(110);
        core.runGroup('g');
        await finish(ending);

        expect(started.l1p).toBe(270);
    });

    it('a flow paused in its delay waits for flows it was given to depend on meanwhile', async () => {
        const { core, started, start, finish } = await setup();
        core.setFlowOptions({ group: 'g', delay: 50 }, 'f');
        core.add({ id: 'a', type: 'work' }, 'f');
        core.add({ id: 'slow', type: 'work', ms: 300 }, 's');
        const ending = start();
        await vi.advanceTimersByTimeAsync(10);
        core.pauseGroup('g');
        core.setFlowOptions({ depends: ['s'] }, 'f');
        await vi.advanceTimersByTimeAsync(90);
        core.runGroup('g');
        await finish(ending);

        expect(started.a).toBe(350);
    });
});
