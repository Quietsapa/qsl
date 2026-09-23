import { describe, it, expect, vi } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * emit(): one stream for everything QSL reports. The logger gets it as a key
 * and arguments; listeners get it as one object with the process and the
 * time.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
    const core = await freshCore();
    core.autoReset = false;
    core.registerType('ok', () => undefined);
    core.registerType('slow', (p) => sleep(p.ms || 20));
    core.registerType('fail', () => Promise.reject(new Error('nope')));
    const signals = [];
    core.listeners.add((signal) => signals.push(signal));
    const of = (id) => signals.filter((s) => s.process?.id === 'qsl-' + id).map((s) => s.type);
    return { core, signals, of };
}

describe('the stream', () => {
    it('carries the type, level, time, process, flow and arguments', async () => {
        const { core, signals } = await setup();
        core.add({ id: 'a', type: 'ok' }, 'main');
        await core.load();

        const started = signals.find((s) => s.type === 'PROCESS_STARTED');
        expect(started.level).toBe('info');
        expect(started.process.id).toBe('qsl-a');
        expect(started.flow).toBe('main');
        expect(started.args).toEqual([]);
        expect(typeof started.time).toBe('number');

        const times = signals.map((s) => s.time);
        expect(times).toEqual([...times].sort((x, y) => x - y));
    });

    it('follows a run from load() to the end', async () => {
        const { core, signals } = await setup();
        core.add({ id: 'a', type: 'ok' }, 'main');
        await core.load();

        expect(signals.map((s) => s.type)).toEqual([
            'PROCESS_ADDED', 'LOAD', 'FLOW_STARTED', 'PROCESS_STARTED',
            'PROCESS_COMPLETED', 'FLOW_COMPLETED', 'ALL_COMPLETED',
        ]);
        expect(signals.find((s) => s.type === 'FLOW_COMPLETED')).toMatchObject({ flow: 'main', process: null, args: ['completed'] });
    });

    it('ends every process with exactly one of completed, failed or skipped, once its state is recorded', async () => {
        const { core, signals } = await setup();
        const states = [];
        core.listeners.add(function ({ type, process }) {
            if (/^PROCESS_(COMPLETED|FAILED|SKIPPED)$/.test(type)) states.push([process.id, type, this.processStates.get(process.id)]);
        });
        core.add({ id: 'good', type: 'ok' });
        core.add({ id: 'bad', type: 'fail' });
        core.add({ id: 'off', type: 'ok', condition: false });
        await core.load();

        expect(states).toEqual(expect.arrayContaining([
            ['qsl-good', 'PROCESS_COMPLETED', 'completed'],
            ['qsl-bad', 'PROCESS_FAILED', 'failed'],
            ['qsl-off', 'PROCESS_SKIPPED', 'skipped'],
        ]));
        expect(states).toHaveLength(3);
        expect(signals.find((s) => s.type === 'PROCESS_FAILED')).toMatchObject({ level: 'error' });
        expect(signals.find((s) => s.type === 'PROCESS_FAILED').args[0].message).toBe('nope');
        expect(signals.find((s) => s.type === 'PROCESS_SKIPPED').args).toEqual(['condition']);
    });

    it('marks when a process was triggered and when its dependencies settled', async () => {
        const { core, of } = await setup();
        let release;
        core.add({ id: 'dep', type: 'slow', ms: 10 });
        core.add({ id: 'late', type: 'ok', depends: ['dep'], trigger: (r) => { release = r; } });
        const loading = core.load();
        await sleep(30);
        release();
        release();
        await loading;

        expect(of('late')).toEqual(['PROCESS_ADDED', 'PROCESS_RESOLVED', 'PROCESS_TRIGGERED', 'PROCESS_STARTED', 'PROCESS_COMPLETED']);
        expect(of('dep')).toEqual(['PROCESS_ADDED', 'PROCESS_STARTED', 'PROCESS_COMPLETED']);
    });

    it('reports retries with the attempt', async () => {
        const { core, signals } = await setup();
        let calls = 0;
        core.registerType('flaky', () => (++calls < 3 ? Promise.reject(new Error('again')) : undefined));
        core.add({ id: 'f', type: 'flaky', retries: 2 });
        await core.load();

        expect(signals.filter((s) => s.type === 'PROCESS_RETRY').map((s) => s.args)).toEqual([[1], [2]]);
    });

    it('reports a skipped flow with its reason', async () => {
        const { core, signals } = await setup();
        core.setFlowOptions({ condition: false }, 'off');
        core.add({ id: 'x', type: 'ok' }, 'off');
        await core.load();

        expect(signals.find((s) => s.type === 'FLOW_SKIPPED')).toMatchObject({ flow: 'off', args: ['condition'] });
    });

    it('reports problems at the error level, with the process or flow they concern', async () => {
        const { core, signals } = await setup();
        core.add({ id: 'x', type: 'ok', depends: ['ghost'] });
        core.setFlowOptions({ depends: ['ghostflow'] }, 'lost');
        core.add({ id: 'y', type: 'ok' }, 'lost');
        await core.load();

        const errors = signals.filter((s) => s.level === 'error');
        expect(errors.find((s) => s.type === 'DEP_NOT_FOUND')).toMatchObject({ args: ['ghost'] });
        expect(errors.find((s) => s.type === 'DEP_NOT_FOUND').process.id).toBe('qsl-x');
        expect(errors.find((s) => s.type === 'FLOW_DEP_SKIPPED')).toMatchObject({ flow: 'lost', process: null, args: ['ghostflow'] });
    });
});

describe('listeners', () => {
    it('one that throws is reported to the logger, and neither the others nor the run stop', async () => {
        const { core, signals } = await setup();
        const lines = [];
        core.setLogger({ log: () => {}, error: (...a) => lines.push(a) });
        core.listeners.add(() => { throw new Error('broken listener'); });
        core.add({ id: 'a', type: 'ok' });
        await core.load();

        expect(signals.some((s) => s.type === 'ALL_COMPLETED')).toBe(true);
        expect(lines.filter(([t]) => t === 'LISTENER_FAILED').length).toBeGreaterThan(0);
        expect(core.processStates.get('qsl-a')).toBe('completed');
    });

    it('stay across runs, and are removed by destroy()', async () => {
        const core = await freshCore();
        core.registerType('ok', () => undefined);
        const seen = vi.fn();
        core.listeners.add(seen);

        core.add({ id: 'a', type: 'ok' });
        await core.load();
        const first = seen.mock.calls.length;
        core.add({ id: 'b', type: 'ok' });
        await core.load();
        expect(seen.mock.calls.length).toBeGreaterThan(first);

        core.destroy();
        expect(core.listeners.size).toBe(0);
    });

    it('the logger still gets a key and ids, not the process', async () => {
        const core = await freshCore();
        core.registerType('ok', () => undefined);
        const lines = [];
        core.setLogger({ log: (...a) => lines.push(a), error: () => {} });
        core.add({ id: 'a', type: 'ok' }, 'main');
        await core.load();

        expect(lines).toContainEqual(['PROCESS_STARTED', 'qsl-a']);
        expect(lines).toContainEqual(['FLOW_COMPLETED', 'main', 'completed']);
        expect(lines.flat().some((a) => a && typeof a === 'object')).toBe(false);
    });
});

describe('DOM events', () => {
    it('are built only after useEvents(), and useEvents() twice adds them once', async () => {
        const core = await freshCore();
        core.registerType('ok', () => undefined);
        const seen = vi.fn();
        window.addEventListener('QSL:completed', seen);

        core.add({ id: 'a', type: 'ok' });
        await core.load();
        expect(seen).not.toHaveBeenCalled();
        expect(core.listeners.size).toBe(0);

        core.useEvents().useEvents();
        expect(core.listeners.size).toBe(1);
        core.add({ id: 'b', type: 'ok' });
        await core.load();
        window.removeEventListener('QSL:completed', seen);

        expect(seen).toHaveBeenCalledTimes(1);
        expect(seen.mock.calls[0][0].detail.id).toBe('qsl-b');
    });

    it('carry the error on QSL:error and nothing extra on QSL:all:completed', async () => {
        const core = await freshCore();
        core.registerType('fail', () => Promise.reject(new Error('nope')));
        core.useEvents();
        const got = [];
        const onError = (e) => got.push(['error', e.detail.id, e.detail.error.message]);
        const onAll = (e) => got.push(['all', e.detail]);
        window.addEventListener('QSL:error', onError);
        window.addEventListener('QSL:all:completed', onAll);

        core.add({ id: 'x', type: 'fail' });
        await core.load();
        window.removeEventListener('QSL:error', onError);
        window.removeEventListener('QSL:all:completed', onAll);

        expect(got).toEqual([['error', 'qsl-x', 'nope'], ['all', null]]);
    });
});
