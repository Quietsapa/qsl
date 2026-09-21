import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * `ordered` decides when a process starts, `strict` whether it runs at all.
 * In a strict ordered flow each process depends on the one before it, and a
 * failure stops the rest of the chain instead of running it out of order.
 */

afterEach(() => {
    vi.useRealTimers();
});

async function setup() {
    const core = await freshCore();
    const ran = [];
    core.registerType('ok', (p) => { ran.push(p.id.replace(/^qsl-/, '')); });
    core.registerType('fail', () => Promise.reject(new Error('boom')));
    core.useEvents();
    const skipped = {};
    const onSkip = (e) => { skipped[e.detail.id.replace(/^qsl-/, '')] = e.detail.reason; };
    window.addEventListener('QSL:skipped', onSkip);
    const stop = () => window.removeEventListener('QSL:skipped', onSkip);
    return { core, ran, skipped, stop };
}

describe('strict ordered flows', () => {
    it('skips everything after a failure, and marks the flow failed', async () => {
        const { core, ran, skipped, stop } = await setup();
        core.setFlowOptions({ ordered: true, strict: true }, 'chain');
        core.add({ id: 'a', type: 'fail' }, 'chain');
        core.add({ id: 'b', type: 'ok' }, 'chain');
        core.add({ id: 'c', type: 'ok' }, 'chain');
        await core.load();
        stop();

        expect(ran).toEqual([]);
        expect(skipped).toEqual({ b: 'dependency', c: 'dependency' });
    });

    it('keeps the flow outcome failed for flows depending on it', async () => {
        const { core, ran, skipped, stop } = await setup();
        core.autoReset = false;
        core.setFlowOptions({ ordered: true, strict: true }, 'chain');
        core.add({ id: 'a', type: 'fail' }, 'chain');
        core.add({ id: 'b', type: 'ok' }, 'chain');
        core.setFlowOptions({ ordered: true, strict: true, depends: ['chain'] }, 'after');
        core.add({ id: 'x', type: 'ok' }, 'after');
        core.setFlowOptions({ depends: ['chain'] }, 'loose');
        core.add({ id: 'y', type: 'ok' }, 'loose');
        await core.load();
        stop();

        expect(core.flowOptions.get('chain').outcome).toBe('failed');
        expect(core.flowOptions.get('after').outcome).toBe('skipped');
        expect(ran).toEqual(['y']);
        expect(skipped.b).toBe('dependency');
    });

    it('lets a process opt out, and the chain resumes after it', async () => {
        const { core, ran, skipped, stop } = await setup();
        core.setFlowOptions({ ordered: true, strict: true }, 'chain');
        core.add({ id: 'a', type: 'fail' }, 'chain');
        core.add({ id: 'b', type: 'ok', strict: false }, 'chain');
        core.add({ id: 'c', type: 'ok' }, 'chain');
        await core.load();
        stop();

        expect(ran).toEqual(['b', 'c']);
        expect(skipped).toEqual({});
    });

    it('follows the instance default', async () => {
        const { core, ran, stop } = await setup();
        core.strict = true;
        core.setFlowOptions({ ordered: true }, 'chain');
        core.add({ id: 'a', type: 'fail' }, 'chain');
        core.add({ id: 'b', type: 'ok' }, 'chain');
        await core.load();
        stop();

        expect(ran).toEqual([]);
    });
});

describe('ordered flows without strict', () => {
    it('run the whole chain after a failure', async () => {
        const { core, ran, skipped, stop } = await setup();
        core.setFlowOptions({ ordered: true }, 'chain');
        core.add({ id: 'a', type: 'fail' }, 'chain');
        core.add({ id: 'b', type: 'ok' }, 'chain');
        core.add({ id: 'c', type: 'ok' }, 'chain');
        await core.load();
        stop();

        expect(ran).toEqual(['b', 'c']);
        expect(skipped).toEqual({});
    });

    it('include the built-in ordered flow', async () => {
        const { core, ran, stop } = await setup();
        core.add({ id: 'a', type: 'fail' }, true);
        core.add({ id: 'b', type: 'ok' }, true);
        await core.load();
        stop();

        expect(ran).toEqual(['b']);
    });

    it('run a flow depending on a failed one', async () => {
        const { core, ran, stop } = await setup();
        core.setFlowOptions({ ordered: true }, 'first');
        core.add({ id: 'a', type: 'fail' }, 'first');
        core.setFlowOptions({ ordered: true, depends: ['first'] }, 'second');
        core.add({ id: 'b', type: 'ok' }, 'second');
        await core.load();
        stop();

        expect(ran).toEqual(['b']);
    });
});

describe('a skip by condition inside an ordered flow', () => {
    it('does not break the chain', async () => {
        const { core, ran, skipped, stop } = await setup();
        core.setFlowOptions({ ordered: true, strict: true }, 'chain');
        core.add({ id: 'a', type: 'ok' }, 'chain');
        core.add({ id: 'b', type: 'ok', condition: () => false }, 'chain');
        core.add({ id: 'c', type: 'ok' }, 'chain');
        await core.load();
        stop();

        expect(ran).toEqual(['a', 'c']);
        expect(skipped).toEqual({ b: 'condition' });
    });

    it('does not repair it either', async () => {
        const { core, ran, skipped, stop } = await setup();
        core.setFlowOptions({ ordered: true, strict: true }, 'chain');
        core.add({ id: 'a', type: 'fail' }, 'chain');
        core.add({ id: 'b', type: 'ok', condition: () => false }, 'chain');
        core.add({ id: 'c', type: 'ok' }, 'chain');
        await core.load();
        stop();

        expect(ran).toEqual([]);
        expect(skipped.c).toBe('dependency');
    });
});

describe('ordered chain and timeout', () => {
    it('skips the rest when a process times out; the late script still runs, alone', async () => {
        vi.useFakeTimers();
        const { core, ran, skipped, stop } = await setup();
        const executed = [];
        core.registerType('slow', (p) => new Promise((r) => setTimeout(() => { executed.push(p.id); r(); }, p.wait)));
        core.setFlowOptions({ ordered: true, strict: true, timeout: 1000 }, 'chain');
        core.add({ id: 'a', type: 'slow', wait: 1500 }, 'chain');
        core.add({ id: 'b', type: 'slow', wait: 100 }, 'chain');
        core.add({ id: 'c', type: 'slow', wait: 100 }, 'chain');
        core.load();
        await vi.advanceTimersByTimeAsync(3000);
        stop();

        expect(executed).toEqual(['qsl-a']);
        expect(skipped).toEqual({ b: 'dependency', c: 'dependency' });
        expect(ran).toEqual([]);
    });
});
