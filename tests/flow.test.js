import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * Behaviour of the core itself: flow options, condition and trigger
 * combinations, lifecycle events and the run lifecycle. Everything here uses
 * the built-in `console` type or small inline types, so no plugin is needed.
 */

const within = (promise, ms = 500) => Promise.race([
    promise.then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('hung'), ms)),
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A type that records when it starts and finishes, and takes `wait` ms.
 */
function registerMark(core, log) {
    const t0 = Date.now();
    core.registerType('mark', (process) => {
        log.push({ id: process.mark, event: 'start', at: Date.now() - t0 });
        return new Promise((resolve) => setTimeout(() => {
            log.push({ id: process.mark, event: 'end', at: Date.now() - t0 });
            resolve();
        }, process.wait || 0));
    });
}

const starts = (log) => log.filter((e) => e.event === 'start').map((e) => e.id);

/**
 * Run a load() on fake timers, so time-based options can be checked to the
 * millisecond instead of against a margin a slow CI runner might exceed.
 */
async function loadOnFakeTimers(core, options) {
    vi.useFakeTimers();
    try {
        const loading = core.load(options);
        await vi.runAllTimersAsync();
        await loading;
    } finally {
        vi.useRealTimers();
    }
}

const at = (log, id, event = 'start') => log.find((e) => e.id === id && e.event === event).at;

function listen(names) {
    const seen = [];
    const off = names.map((name) => {
        const fn = (e) => seen.push([name, e.detail?.id]);
        window.addEventListener('QSL:' + name, fn);
        return () => window.removeEventListener('QSL:' + name, fn);
    });
    seen.stop = () => off.forEach((f) => f());
    return seen;
}

afterEach(() => {
    delete window.QSLReady;
    delete window.myReady;
});

describe('flow options', () => {
    it('delay holds the flow before its first process', async () => {
        const core = await freshCore();
        const log = [];

        core.setFlowOptions({ delay: 60 }, 'late');
        core.add({ id: 'a', type: 'mark', mark: 'a' }, 'late');
        core.add({ id: 'b', type: 'mark', mark: 'b' }, 'now');
        vi.useFakeTimers();
        registerMark(core, log);
        await loadOnFakeTimers(core);

        expect(at(log, 'a') - at(log, 'b')).toBe(60);
    });

    it('between staggers the processes of an unordered flow', async () => {
        const core = await freshCore();
        const log = [];

        core.setFlowOptions({ between: 40 }, 'f');
        core.add({ id: 'a', type: 'mark', mark: 'a', wait: 100 }, 'f');
        core.add({ id: 'b', type: 'mark', mark: 'b' }, 'f');
        vi.useFakeTimers();
        registerMark(core, log);
        await loadOnFakeTimers(core);

        /**
         * Staggered starts, not sequential: b does not wait for a to end.
         */
        expect(at(log, 'b') - at(log, 'a')).toBe(40);
        expect(at(log, 'b')).toBeLessThan(at(log, 'a', 'end'));
    });

    it('between in an ordered flow waits after each process ends', async () => {
        const core = await freshCore();
        const log = [];

        core.setFlowOptions({ ordered: true, between: 40 }, 'f');
        core.add({ id: 'a', type: 'mark', mark: 'a', wait: 20 }, 'f');
        core.add({ id: 'b', type: 'mark', mark: 'b' }, 'f');
        vi.useFakeTimers();
        registerMark(core, log);
        await loadOnFakeTimers(core);

        expect(at(log, 'b') - at(log, 'a', 'end')).toBe(40);
    });

    it('load({ between }) is the default, and a flow can override it with 0', async () => {
        const core = await freshCore();
        const log = [];

        core.add({ id: 'a', type: 'mark', mark: 'a' }, 'global');
        core.add({ id: 'b', type: 'mark', mark: 'b' }, 'global');
        core.setFlowOptions({ between: 0 }, 'own');
        core.add({ id: 'c', type: 'mark', mark: 'c' }, 'own');
        core.add({ id: 'd', type: 'mark', mark: 'd' }, 'own');
        vi.useFakeTimers();
        registerMark(core, log);
        await loadOnFakeTimers(core, { between: 40 });

        expect(at(log, 'b') - at(log, 'a')).toBe(40);
        expect(at(log, 'd') - at(log, 'c')).toBe(0);
    });

    it('priority orders flows, and flows with a trigger always start last', async () => {
        const core = await freshCore();
        const log = [];
        registerMark(core, log);

        core.setFlowOptions({ priority: 1 }, 'low');
        core.setFlowOptions({ priority: 10 }, 'high');
        core.setFlowOptions({ priority: 100, trigger: (cb) => cb() }, 'triggered');
        core.add({ id: 'low', type: 'mark', mark: 'low' }, 'low');
        core.add({ id: 'triggered', type: 'mark', mark: 'triggered' }, 'triggered');
        core.add({ id: 'high', type: 'mark', mark: 'high' }, 'high');
        await core.load();

        expect(starts(log)).toEqual(['high', 'low', 'triggered']);
    });

    it('priority orders processes inside an ordered flow', async () => {
        const core = await freshCore();
        const log = [];
        registerMark(core, log);

        core.add({ id: 'a', type: 'mark', mark: 'a' }, true);
        core.add({ id: 'b', type: 'mark', mark: 'b', priority: 5 }, true);
        core.add({ id: 'c', type: 'mark', mark: 'c', priority: 10 }, true);
        await core.load();

        expect(starts(log)).toEqual(['c', 'b', 'a']);
    });

    it('onBeforeStart runs before the first process and onComplete after the last', async () => {
        const core = await freshCore();
        const order = [];

        core.setFlowOptions({
            onBeforeStart: () => order.push('beforeStart'),
            onComplete: () => order.push('onComplete'),
        }, 'f');
        core.add({ id: 'a', onComplete: () => order.push('a') }, 'f');
        await core.load();

        expect(order).toEqual(['beforeStart', 'a', 'onComplete']);
    });

    it('setFlowOptions merges with what was set before', async () => {
        const core = await freshCore();
        core.setFlowOptions({ delay: 5, group: 'g' }, 'f');
        core.setFlowOptions({ priority: 3 }, 'f');

        const options = core.flows.get('f').options;
        expect(options).toMatchObject({ delay: 5, group: 'g', priority: 3 });
    });
});

describe('condition combinations', () => {
    const t = () => true;
    const f = () => false;

    it.each([
        ['true', true, true],
        ['false', false, false],
        ['a truthy function', t, true],
        ['a falsy function', f, false],
        ['an empty array', [], true],
        ['an array, all pass', [t, true], true],
        ['an array, one fails', [t, f], false],
        ['or, one passes', { operator: 'or', conditions: [f, t] }, true],
        ['or, none pass', { operator: 'or', conditions: [f, false] }, false],
        ['and, all pass', { operator: 'and', conditions: [t, t] }, true],
        ['and, one fails', { operator: 'and', conditions: [t, f] }, false],
        ['or nested in an array', [t, { operator: 'or', conditions: [f, t] }], true],
        ['an array nested in or', { operator: 'or', conditions: [[t, f], [t, t]] }, true],
        ['an unknown operator', { operator: 'xor', conditions: [f] }, true],
        ['an operator without a list', { operator: 'or' }, true],
        ['a string no handler knows', 'nobody:owns:this', true],
    ])('%s → runs: %s', async (_, condition, runs) => {
        const core = await freshCore();
        const ran = [];
        core.add({ id: 'x', condition, onComplete: () => ran.push('x') });
        await core.load();
        expect(ran.length === 1).toBe(runs);
    });
});

describe('trigger combinations', () => {
    /**
     * A trigger the test fires by name.
     */
    function manual() {
        const pending = {};
        const make = (name) => (cb) => { pending[name] = cb; };
        const fire = (name) => pending[name]?.();
        return { make, fire };
    }

    it('an array waits for every trigger', async () => {
        const core = await freshCore();
        const { make, fire } = manual();
        const ran = [];

        core.add({ id: 'x', trigger: [make('a'), make('b')], onComplete: () => ran.push('x') });
        const loading = core.load();

        fire('a');
        await sleep(10);
        expect(ran).toEqual([]);
        fire('b');
        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['x']);
    });

    it('or fires on the first trigger, once', async () => {
        const core = await freshCore();
        const { make, fire } = manual();
        let runs = 0;

        core.setFlowOptions({ trigger: { operator: 'or', triggers: [make('a'), make('b')] } }, 'f');
        core.add({ id: 'x', onComplete: () => runs++ }, 'f');
        const loading = core.load();

        fire('b');
        fire('a');
        expect(await within(loading)).toBe('resolved');
        expect(runs).toBe(1);
    });

    it('and waits for every trigger, like an array', async () => {
        const core = await freshCore();
        const { make, fire } = manual();

        core.add({ id: 'x', trigger: { operator: 'and', triggers: [make('a'), make('b')] } });
        const loading = core.load();

        fire('b');
        expect(await within(loading, 50)).toBe('hung');
        fire('a');
        expect(await within(loading)).toBe('resolved');
    });

    it('nests: or of two all-of groups', async () => {
        const core = await freshCore();
        const { make, fire } = manual();

        core.add({ id: 'x', trigger: { operator: 'or', triggers: [[make('a'), make('b')], [make('c'), make('d')]] } });
        const loading = core.load();

        fire('a');
        fire('c');
        expect(await within(loading, 50)).toBe('hung');
        fire('d');
        expect(await within(loading)).toBe('resolved');
    });

    it.each([
        ['an empty array', []],
        ['or with nothing known in it', { operator: 'or', triggers: ['nobody-owns-this'] }],
        ['a string no handler knows', 'nobody-owns-this'],
        ['an unknown operator', { operator: 'xor', triggers: [] }],
    ])('%s does not hold the process', async (_, trigger) => {
        const core = await freshCore();
        core.add({ id: 'x', trigger });
        expect(await within(core.load())).toBe('resolved');
    });

    it('a process trigger and its dependencies are both awaited', async () => {
        const core = await freshCore();
        const { make, fire } = manual();
        const order = [];

        core.add({ id: 'dep', trigger: make('dep'), onComplete: () => order.push('dep') });
        core.add({ id: 'x', depends: ['dep'], trigger: make('x'), onComplete: () => order.push('x') });
        const loading = core.load();

        fire('x');
        await sleep(10);
        expect(order).toEqual([]);
        fire('dep');
        expect(await within(loading)).toBe('resolved');
        expect(order).toEqual(['dep', 'x']);
    });
});

describe('lifecycle events', () => {
    it('fire started before exactly one outcome per process, then all:completed once', async () => {
        const core = await freshCore();
        const seen = listen(['started', 'completed', 'error', 'skipped', 'all:completed']);

        core.registerType('broken', () => Promise.reject(new Error('x')));
        core.add({ id: 'ok' });
        core.add({ id: 'skip', condition: false });
        core.add({ id: 'fail', type: 'broken' });
        await core.load();
        seen.stop();

        const forId = (id) => seen.filter(([, d]) => d === 'qsl-' + id).map(([n]) => n);
        expect(forId('ok')).toEqual(['started', 'completed']);
        expect(forId('skip')).toEqual(['skipped']);
        expect(forId('fail')).toEqual(['started', 'error']);
        expect(seen.filter(([n]) => n === 'all:completed').length).toBe(1);
        expect(seen[seen.length - 1][0]).toBe('all:completed');
    });

    it('carry the whole process config as detail', async () => {
        const core = await freshCore();
        let detail = null;
        const fn = (e) => { detail = e.detail; };
        window.addEventListener('QSL:completed', fn);

        core.add({ id: 'x', message: 'hello', custom: 42 }, 'f');
        await core.load();
        window.removeEventListener('QSL:completed', fn);

        expect(detail).toMatchObject({ id: 'qsl-x', type: 'console', flowId: 'f', custom: 42 });
    });
});

describe('run lifecycle', () => {
    it('load() with nothing added resolves at once', async () => {
        const core = await freshCore();
        expect(await within(core.load())).toBe('resolved');
        expect(core.hasStarted).toBe(false);
    });

    it('a second load() during a run does not start it again', async () => {
        const core = await freshCore();
        let runs = 0;
        core.add({ id: 'x', delay: 30, onComplete: () => runs++ });

        const first = core.load();
        const second = core.load();
        expect(await within(second)).toBe('resolved');
        await first;
        expect(runs).toBe(1);
    });

    it('setOnAllComplete runs once at the end of every run, and destroy() clears it', async () => {
        const core = await freshCore();
        let calls = 0;
        core.setOnAllComplete(() => calls++);
        core.add({ id: 'x' });
        await core.load();
        expect(calls).toBe(1);
        core.add({ id: 'y' });
        await core.load();
        expect(calls).toBe(2);

        core.setOnAllComplete('not a function');
        expect(core._onAllComplete).toBeNull();
        core.setOnAllComplete(() => {});
        core.destroy();
        expect(core._onAllComplete).toBeNull();
    });

    it('init() twice returns the same instance and registers nothing twice', async () => {
        const core = await freshCore();
        const types = core.types.size;
        expect(await core.init()).toBe(core);
        expect(core.types.size).toBe(types);
    });

    it('use() passes extra arguments and ignores non-functions', async () => {
        const core = await freshCore();
        let received = null;
        expect(core.use((qsl, a, b) => { received = [qsl, a, b]; }, 1, 2)).toBe(core);
        expect(received).toEqual([core, 1, 2]);
        expect(core.use('nope')).toBe(core);
    });

    it('setLogger accepts an object and ignores anything else', async () => {
        const core = await freshCore();
        const lines = [];
        core.setLogger({ log: (...a) => lines.push(a), error: () => {} });
        core.setLogger(null);
        core.add({ id: 'x', message: 'hi' });
        await core.load();
        expect(lines).toContainEqual(['MESSAGE', 'qsl-x', 'hi']);
    });
});

describe('async loading callback', () => {
    async function initWithScript(src) {
        vi.resetModules();
        const core = (await import('../src/core.js')).default;
        const script = document.createElement('script');
        script.src = src;
        Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
        try {
            await core.init();
        } finally {
            delete document.currentScript;
        }
        return core;
    }

    it.each([
        ['https://cdn.example/qsl.min.js?async=true', 'QSLReady', true],
        ['https://cdn.example/qsl.min.js?async=true&callback=myReady', 'myReady', true],
        ['https://cdn.example/qsl.min.js?async=true&callback=myReady', 'QSLReady', false],
        ['https://cdn.example/qsl.min.js', 'QSLReady', false],
        ['https://cdn.example/qsl.min.js?async=1', 'QSLReady', false],
    ])('%s calls %s: %s', async (src, name, called) => {
        let calls = 0;
        window[name] = () => calls++;
        await initWithScript(src);
        expect(calls).toBe(called ? 1 : 0);
    });

    it('does nothing when the named callback does not exist', async () => {
        await expect(initWithScript('https://cdn.example/qsl.min.js?async=true&callback=missing')).resolves.toBeTruthy();
    });
});

describe('add()', () => {
    it('true is the ordered flow', async () => {
        const core = await freshCore();
        core.add({ id: 'x' }, true);
        expect(core.flows.get('ordered').processes[0].id).toBe('qsl-x');
        expect(core.flows.get('ordered').options.ordered).toBe(true);
    });

    it.each([[null], [undefined], [false], [{}]])('flow %s is the default flow', async (flowId) => {
        const core = await freshCore();
        core.add({ id: 'x' }, flowId);
        expect(core.flows.get('default').processes[0].id).toBe('qsl-x');
    });

    it('generates an id and defaults the type to console', async () => {
        const core = await freshCore();
        core.add({});
        const process = core.flows.get('default').processes[0];
        expect(process.id).toMatch(/^qsl-[a-z0-9]+$/);
        expect(process.type).toBe('console');
    });

    it('removes duplicate dependencies', async () => {
        const core = await freshCore();
        core.add({ id: 'x', depends: ['a', 'a', 'b'] });
        expect(core.flows.get('default').processes[0].depends).toEqual(['a', 'b']);
    });

    it('ignores anything that is not an object, and stays chainable', async () => {
        const core = await freshCore();
        expect(core.add(null)).toBe(core);
        expect(core.add('x')).toBe(core);
        expect(core.flows.size).toBe(0);
    });
});

describe('dependencies that point nowhere', () => {
    it('a missing process dependency is reported as an error and the process runs', async () => {
        const core = await freshCore();
        const lines = [];
        core.setLogger({ log: () => {}, error: (...a) => lines.push(a) });
        const ran = [];

        core.add({ id: 'x', depends: ['nope'], onComplete: () => ran.push('x') });
        await core.load();

        expect(ran).toEqual(['x']);
        expect(lines.find(([t]) => t === 'DEP_NOT_FOUND')).toEqual(['DEP_NOT_FOUND', 'qsl-x', 'nope']);
    });

    it('a flow depending on a flow that does not exist runs, like a process; strict, it is skipped', async () => {
        const core = await freshCore();
        const seen = listen(['skipped']);
        const ran = [];

        core.setFlowOptions({ depends: ['nope'] }, 'f');
        core.setFlowOptions({ depends: ['nope'], strict: true }, 'g');
        core.add({ id: 'x', onComplete: () => ran.push('x') }, 'f');
        core.add({ id: 'y', onComplete: () => ran.push('y') }, 'g');
        expect(await within(core.load())).toBe('resolved');
        seen.stop();

        expect(ran).toEqual(['x']);
        expect([...seen]).toEqual([['skipped', 'qsl-y']]);
    });

    it('a strict process is skipped when its dependency in another flow fails', async () => {
        const core = await freshCore();
        core.registerType('broken', () => Promise.reject(new Error('x')));
        const ran = [];

        core.add({ id: 'sdk', type: 'broken' }, 'a');
        core.add({ id: 'plugin', depends: ['sdk'], strict: true, onComplete: () => ran.push('plugin') }, 'b');
        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual([]);
    });
});

describe('unknown type', () => {
    it('reports it as an error, settles the process as failed and fires QSL:error', async () => {
        const core = await freshCore();
        const lines = [];
        core.setLogger({ log: () => {}, error: (...a) => lines.push(a) });
        let error = null;
        const fn = (e) => { error = e.detail.error; };
        window.addEventListener('QSL:error', fn);

        core.add({ id: 'x', type: 'carousel' });
        expect(await within(core.load())).toBe('resolved');
        window.removeEventListener('QSL:error', fn);

        const [type, id, logged] = lines.find(([t]) => t === 'PROCESS_FAILED');
        expect([type, id, logged.message]).toEqual(['PROCESS_FAILED', 'qsl-x', 'Unknown type: carousel']);
        expect(error.message).toBe('Unknown type: carousel');
    });
});

describe('plugin hooks', () => {
    it('a plugin follows the run through its signals: LOAD, PROCESS_*, RESET', async () => {
        const core = await freshCore();
        const order = [];
        core.listeners.add(({ type, process }) => {
            if (type === 'LOAD' || type === 'RESET') order.push(type);
            if (type === 'PROCESS_COMPLETED') order.push('process:' + process.id);
        });
        core.setOnAllComplete(() => order.push('onAllComplete'));

        core.add({ id: 'x' });
        await core.load();

        /**
         * With autoReset the run is cleared before the completion callbacks,
         * so what they do belongs to the next run.
         */
        expect(order).toEqual(['LOAD', 'process:qsl-x', 'RESET', 'onAllComplete']);
    });

    it('handlerCallbacksFilters hand extra callbacks to every type handler', async () => {
        const core = await freshCore();
        let received = null;
        core.handlerCallbacksFilters.add(() => ({ hello: () => 'world' }));
        core.registerType('probe', (process, callbacks) => { received = callbacks.hello(); return Promise.resolve(); });

        core.add({ id: 'x', type: 'probe' });
        await core.load();
        expect(received).toBe('world');
    });

});

describe('combined plugins', () => {
    it('conditions and triggers register every handler at once', async () => {
        const core = await freshCore();
        const { default: conditions } = await import('../src/plugins/conditions.js');
        const { default: triggers } = await import('../src/plugins/triggers.js');
        core.use(conditions).use(triggers);
        expect(core.conditionHandlers.size).toBe(5);
        expect(core.triggerHandlers.size).toBe(9);
    });
});


describe('processStates', () => {
    it('records how each process ended, by its prefixed id', async () => {
        const core = await freshCore();
        core.autoReset = false;
        core.registerType('ok', () => {});
        core.registerType('fail', () => Promise.reject(new Error('x')));

        core.add({ id: 'a', type: 'ok' });
        core.add({ id: 'b', type: 'fail' });
        core.add({ id: 'c', type: 'ok', condition: () => false });
        await core.load();

        expect(Object.fromEntries(core.processStates)).toEqual({ 'qsl-a': 'completed', 'qsl-b': 'failed', 'qsl-c': 'skipped' });
        core.reset();
        expect(core.processStates.size).toBe(0);
    });
});

describe('groups', () => {
    it('follow a flow that changes group', async () => {
        const core = await freshCore();
        core.setFlowOptions({ group: 'ads', paused: true }, 'f');
        core.setFlowOptions({ group: 'analytics' }, 'f');
        expect(core.inGroup('ads')).toEqual([]);
        expect(core.inGroup('analytics')).toEqual(['f']);
    });
});

describe('a flow trigger', () => {
    it('is armed once: released by runFlow(id, true), paused in its delay and run again, it does not arm afresh', async () => {
        const core = await freshCore();
        const ran = [];
        let armed = 0;
        core.registerType('mark', (p) => { ran.push(p.id); });
        core.setFlowOptions({ group: 'g', delay: 20, trigger: () => { armed++; } }, 'f');
        core.add({ id: 'x', type: 'mark' }, 'f');
        const loading = core.load();
        expect(core.flows.get('f').phase).toBe('armed');

        core.runFlow('f', true);
        expect(core.flows.get('f').phase).toBe('delay');
        core.pauseGroup('g');
        await new Promise((r) => setTimeout(r, 30));
        expect(core.flows.get('f').phase).toBe('ready');
        core.runGroup('g');

        expect(await within(loading)).toBe('resolved');
        expect(armed).toBe(1);
        expect(ran).toEqual(['qsl-x']);
    });
});

describe('flow callbacks', () => {
    it('onBeforeStart and onComplete run once per flow, around its processes, before the end of the run', async () => {
        const core = await freshCore();
        const order = [];
        core.registerType('mark', (p) => { order.push('process:' + p.id.replace(/^qsl-/, '')); });
        core.setFlowOptions({ onBeforeStart: () => order.push('start:a'), onComplete: () => order.push('done:a') }, 'a');
        core.setFlowOptions({ onBeforeStart: () => order.push('start:b'), onComplete: () => order.push('done:b'), depends: ['a'] }, 'b');
        core.add({ id: 'x', type: 'mark' }, 'a');
        core.add({ id: 'y', type: 'mark' }, 'b');
        core.setOnAllComplete(() => order.push('all'));
        await core.load();

        expect(order).toEqual(['start:a', 'process:x', 'done:a', 'start:b', 'process:y', 'done:b', 'all']);
    });

    it('uses the callbacks the flow has when they are due, not those it had when it started', async () => {
        const core = await freshCore();
        const calls = [];
        core.registerType('slow', () => new Promise((r) => setTimeout(r, 20)));
        core.setFlowOptions({ delay: 10, onBeforeStart: () => calls.push('old start'), onComplete: () => calls.push('old done') }, 'f');
        core.add({ id: 'a', type: 'slow' }, 'f');
        const loading = core.load();
        core.setFlowOptions({ onBeforeStart: () => calls.push('new start') }, 'f');
        await new Promise((r) => setTimeout(r, 15));
        core.setFlowOptions({ onComplete: () => calls.push('new done') }, 'f');
        await loading;

        expect(calls).toEqual(['new start', 'new done']);
    });

    it('a flow ends with exactly one of onComplete and onError, as a process does', async () => {
        const core = await freshCore();
        const calls = [];
        core.registerType('fail', () => Promise.reject(new Error('x')));
        const both = (id) => ({ onComplete: () => calls.push(id + ':complete'), onError: () => calls.push(id + ':error') });

        /**
         * A failure fails the flow; a condition that skips a process does not.
         */
        core.setFlowOptions(both('failed'), 'failed');
        core.add({ id: 'a', type: 'fail' }, 'failed');
        core.add({ id: 'b', condition: () => false }, 'failed');
        core.setFlowOptions(both('fine'), 'fine');
        core.add({ id: 'c', condition: () => false }, 'fine');
        core.add({ id: 'd' }, 'fine');

        /**
         * A process skipped because its dependency failed fails its flow too.
         */
        core.setFlowOptions(both('after'), 'after');
        core.add({ id: 'e', depends: ['a'], strict: true }, 'after');

        /**
         * A skipped flow gets neither: FLOW_SKIPPED and QSL:flow:skipped say so.
         */
        core.setFlowOptions({ ...both('off'), condition: false }, 'off');
        core.add({ id: 'f' }, 'off');
        await core.load();

        expect(calls.sort()).toEqual(['after:error', 'failed:error', 'fine:complete']);
    });

});
