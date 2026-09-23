import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * Waiting, as one graph: cycles that run through `depends`, order and flow
 * dependencies together, cycles made while the run is under way, and
 * dependencies that do not exist. Each case here was first found by the
 * property tests in fuzz.test.js.
 */

const within = (promise, ms = 1000) => Promise.race([
    promise.then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('hung'), ms)),
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * add() works on a copy of the config: read the outcome off the core.
 */
const reason = (core, id) => core.processIndex.get('qsl-' + id)?.skipReason;

async function setup() {
    const core = await freshCore();
    core.autoReset = false;
    const ran = [];
    core.registerType('mark', (p) => { ran.push(p.id.replace(/^qsl-/, '')); });
    core.registerType('slow', (p) => sleep(p.ms || 30).then(() => { ran.push(p.id.replace(/^qsl-/, '')); }));
    const errors = [];
    core.listeners.add(({ type, level }) => { if (level === 'error') errors.push(type); });
    return { core, ran, errors };
}

describe('cycles no single kind of dependency shows', () => {
    it('depends against the order of an ordered flow', async () => {
        const { core, ran, errors } = await setup();
        core.setFlowOptions({ ordered: true }, 'f');
        const first = { id: 'first', type: 'mark', priority: 1, depends: ['second'] };
        const second = { id: 'second', type: 'mark', priority: 0 };
        core.add(first, 'f').add(second, 'f');
        core.add({ id: 'free', type: 'mark' }, 'g');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['free']);
        expect(reason(core, 'first')).toBe('circular');
        expect(reason(core, 'second')).toBe('circular');
        expect(errors).toContain('CIRC_PROCESS_DEP_SKIPPED');
    });

    it('depends against flow depends', async () => {
        const { core, ran } = await setup();
        core.setFlowOptions({ depends: ['one'] }, 'two');
        const a = { id: 'a', type: 'mark', depends: ['b'] };
        const b = { id: 'b', type: 'mark' };
        const c = { id: 'c', type: 'mark' };
        core.add(a, 'one').add(c, 'one').add(b, 'two');

        expect(await within(core.load())).toBe('resolved');
        expect(reason(core, 'a')).toBe('circular');
        expect(reason(core, 'b')).toBe('circular');
        expect(ran).toEqual(['c']);
    });

    it('skips only what is on the cycle: what depends on it follows the usual rules', async () => {
        const { core, ran } = await setup();
        core.add({ id: 'x', type: 'mark', depends: ['y'] });
        core.add({ id: 'y', type: 'mark', depends: ['x'] });
        const loose = { id: 'loose', type: 'mark', depends: ['x'] };
        const tight = { id: 'tight', type: 'mark', depends: ['x'], strict: true };
        core.add(loose).add(tight);

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['loose']);
        expect(reason(core, 'tight')).toBe('dependency');
    });

    it('a flow cycle skips the flows, and a process depending on them runs', async () => {
        const { core, ran } = await setup();
        core.setFlowOptions({ depends: ['self'] }, 'self');
        core.add({ id: 'inside', type: 'mark' }, 'self');
        core.add({ id: 'outside', type: 'mark', depends: ['inside'] }, 'main');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['outside']);
        expect(core.processStates.get('qsl-inside')).toBe('skipped');
    });
});

describe('cycles made during the run', () => {
    it('a late process that depends on itself', async () => {
        const { core, ran } = await setup();
        const late = { id: 'late', type: 'mark', depends: ['late'] };
        core.registerType('adder', () => { core.add(late, 'later'); });
        core.add({ id: 'adder', type: 'adder' });

        expect(await within(core.load())).toBe('resolved');
        expect(reason(core, 'late')).toBe('circular');
        expect(ran).toEqual([]);
    });

    it('late processes that depend on each other, and one that waits for them', async () => {
        const { core, ran } = await setup();
        core.registerType('adder', () => {
            core.add({ id: 'p', type: 'mark', depends: ['q'] }, 'later');
            core.add({ id: 'q', type: 'mark', depends: ['p'] }, 'later');
            core.add({ id: 'r', type: 'mark', depends: ['p'] }, 'later');
        });
        core.add({ id: 'adder', type: 'adder' });

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['r']);
    });

    it('late flows that come to depend on each other', async () => {
        const { core, ran } = await setup();
        core.registerType('adder', () => {
            core.setFlowOptions({ depends: ['lb'] }, 'la');
            core.setFlowOptions({ depends: ['la'] }, 'lb');
            core.add({ id: 'a', type: 'mark' }, 'la');
            core.add({ id: 'b', type: 'mark' }, 'lb');
            core.add({ id: 'c', type: 'mark' }, 'lc');
        });
        core.add({ id: 'adder', type: 'adder' });

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['c']);
    });

    it('a regular process that depends on one added late into a flow that has to wait for it', async () => {
        const { core, ran } = await setup();
        const waiting = { id: 'waiting', type: 'slow', ms: 20, depends: ['late'] };
        core.registerType('adder', () => { core.add({ id: 'late', type: 'mark' }, 'later'); });
        core.add({ id: 'adder', type: 'adder' }, 'one');
        core.add({ id: 'gate', type: 'slow', ms: 10 }, 'two');
        core.setFlowOptions({ ordered: true }, 'two');
        core.add(waiting, 'two');

        expect(await within(core.load())).toBe('resolved');
        expect(reason(core, 'waiting')).toBe('circular');
    });

    it('a process already waiting when the cycle closes is let go', async () => {
        const { core, ran } = await setup();
        core.registerType('adder', () => sleep(10).then(() => { core.add({ id: 'late', type: 'mark' }, 'later'); }));
        core.add({ id: 'adder', type: 'adder' }, 'one');
        core.add({ id: 'slow', type: 'slow', ms: 40 }, 'one');
        core.add({ id: 'waiting', type: 'mark', depends: ['slow', 'late'] }, 'two');

        expect(await within(core.load())).toBe('resolved');
        expect(reason(core, 'waiting')).toBe('circular');
        expect(reason(core, 'late')).toBe('circular');
        expect(ran).toEqual(['slow']);
    });

    it('a late add reusing the id of a running process is not a cycle', async () => {
        const { core, ran } = await setup();
        core.registerType('adder', () => {
            core.add({ id: 'same', type: 'mark' }, 'later');
            return sleep(20);
        });
        core.add({ id: 'same', type: 'adder' });

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['same']);
    });

    it('a burst of late adds is looked at in one pass', async () => {
        const { core, ran } = await setup();
        let passes = 0;
        const breakCycles = core.breakCycles;
        core.breakCycles = function (...args) {
            passes++;
            return breakCycles.apply(this, args);
        };
        core.registerType('adder', () => {
            for (let i = 0; i < 50; i++) core.add({ id: 'l' + i, type: 'mark', depends: i ? ['l' + (i - 1)] : [] }, 'later');
        });
        core.add({ id: 'adder', type: 'adder' });

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toHaveLength(50);
        expect(passes).toBe(2);
    });
});

describe('dependencies that do not exist', () => {
    it('do not release a process before its other dependencies settle', async () => {
        const { core, ran, errors } = await setup();
        core.add({ id: 'slow', type: 'slow', ms: 30 }, 'one');
        core.add({ id: 'after', type: 'mark', depends: ['ghost', 'slow'] }, 'two');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['slow', 'after']);
        expect(errors).toContain('DEP_NOT_FOUND');
    });

    it('count as skipped for a strict process', async () => {
        const { core, ran } = await setup();
        const strict = { id: 'strict', type: 'mark', depends: ['ghost'], strict: true };
        core.add(strict);

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual([]);
        expect(reason(core, 'strict')).toBe('dependency');
    });

    it('a strict process is skipped without waiting for its trigger', async () => {
        const { core } = await setup();
        const strict = { id: 'strict', type: 'mark', depends: ['ghost'], strict: true, trigger: () => {} };
        core.add(strict);

        expect(await within(core.load())).toBe('resolved');
        expect(reason(core, 'strict')).toBe('dependency');
    });

    it('a process that is not strict still waits for its trigger', async () => {
        const { core, ran } = await setup();
        let release;
        core.add({ id: 'loose', type: 'mark', depends: ['ghost'], trigger: (r) => { release = r; } });
        const loading = core.load();

        await sleep(20);
        expect(ran).toEqual([]);
        release();
        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['loose']);
    });

    it('a flow after a flow whose dependency does not exist is not left waiting', async () => {
        const { core, ran, errors } = await setup();
        core.setFlowOptions({ depends: ['ghostflow'] }, 'missing');
        core.setFlowOptions({ depends: ['missing'] }, 'after');
        core.add({ id: 'm', type: 'mark' }, 'missing');
        core.add({ id: 'a', type: 'mark' }, 'after');

        expect(await within(core.load())).toBe('resolved');
        expect(core.processStates.get('qsl-m')).toBe('skipped');
        expect(ran).toEqual(['a']);
        expect(errors).toContain('FLOW_DEP_SKIPPED');
    });
});

describe('many dependencies', () => {
    it('a process waiting for many runs once, after the last', async () => {
        const { core, ran } = await setup();
        const ids = Array.from({ length: 200 }, (_, i) => 'd' + i);
        for (const id of ids) core.add({ id, type: 'mark' }, 'f' + (id.length % 3));
        core.add({ id: 'last', type: 'mark', depends: ids }, 'end');

        expect(await within(core.load())).toBe('resolved');
        expect(ran.at(-1)).toBe('last');
        expect(ran.filter((id) => id === 'last')).toHaveLength(1);
    });

    it('a long chain declared in reverse still runs in order', async () => {
        const { core, ran } = await setup();
        core.yield = false;
        const n = 1000;
        for (let i = 0; i < n; i++) core.add({ id: 'c' + i, type: 'mark', depends: i < n - 1 ? ['c' + (i + 1)] : [] });

        expect(await within(core.load())).toBe('resolved');
        expect(ran[0]).toBe('c' + (n - 1));
        expect(ran.at(-1)).toBe('c0');
    });
});
