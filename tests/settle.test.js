import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';

/**
 * Every process settles exactly once — completed, failed or skipped — and all
 * three release whatever depends on it. `strict` decides whether a failed or
 * skipped dependency is acceptable to the dependent.
 */

const within = (promise, ms = 500) => Promise.race([
    promise.then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('hung'), ms)),
]);

function record(core) {
    core.useEvents();
    const events = [];
    const listeners = ['started', 'completed', 'error', 'skipped'].map((name) => {
        const fn = (e) => events.push({ name, id: e.detail.id, reason: e.detail.reason, error: e.detail.error });
        window.addEventListener('QSL:' + name, fn);
        return [name, fn];
    });
    events.stop = () => listeners.forEach(([n, fn]) => window.removeEventListener('QSL:' + n, fn));
    return events;
}

function failingType(core) {
    core.registerType('broken', () => Promise.reject(new Error('blocked')));
}

describe('processes skipped by a condition', () => {
    it('settle as skipped instead of leaving dependents waiting forever', async () => {
        const core = await freshCore();
        const events = record(core);
        const ran = [];

        core.add({ id: 'sdk', condition: false, onComplete: () => ran.push('sdk') });
        core.add({ id: 'plugin', depends: ['sdk'], onComplete: () => ran.push('plugin') });

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(ran).toEqual(['plugin']);
        expect(events.find((e) => e.name === 'skipped')).toMatchObject({ id: 'qsl-sdk', reason: 'condition' });
    });

    it('skip their dependents too when the dependent is strict', async () => {
        const core = await freshCore();
        const events = record(core);
        const ran = [];

        core.add({ id: 'sdk', condition: false });
        core.add({ id: 'plugin', depends: ['sdk'], strict: true, onComplete: () => ran.push('plugin') });
        core.add({ id: 'addon', depends: ['plugin'], strict: true, onComplete: () => ran.push('addon') });

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(ran).toEqual([]);
        const skipped = events.filter((e) => e.name === 'skipped').map((e) => [e.id, e.reason]);
        expect(skipped).toEqual([
            ['qsl-sdk', 'condition'],
            ['qsl-plugin', 'dependency'],
            ['qsl-addon', 'dependency'],
        ]);
    });

    it('do not make a strict dependent wait for its own trigger first', async () => {
        const core = await freshCore();
        const events = record(core);

        core.add({ id: 'sdk', condition: false });
        core.add({ id: 'plugin', depends: ['sdk'], strict: true, trigger: () => {} });

        expect(await within(core.load())).toBe('resolved');
        events.stop();
        expect(events.map((e) => e.name)).toEqual(['skipped', 'skipped']);
    });
});

describe('processes whose handler fails', () => {
    it('fire QSL:error with the process and the error, then release dependents', async () => {
        const core = await freshCore();
        failingType(core);
        const events = record(core);
        const ran = [];

        core.add({ id: 'sdk', type: 'broken' });
        core.add({ id: 'plugin', depends: ['sdk'], onComplete: () => ran.push('plugin') });

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        const error = events.find((e) => e.name === 'error');
        expect(error.id).toBe('qsl-sdk');
        expect(error.error.message).toBe('blocked');
        expect(events.some((e) => e.name === 'completed' && e.id === 'qsl-sdk')).toBe(false);
        expect(ran).toEqual(['plugin']);
    });

    it('skip strict dependents', async () => {
        const core = await freshCore();
        failingType(core);
        const events = record(core);
        const ran = [];

        core.add({ id: 'sdk', type: 'broken' });
        core.add({ id: 'plugin', depends: ['sdk'], strict: true, onComplete: () => ran.push('plugin') });

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(ran).toEqual([]);
        expect(events.find((e) => e.name === 'skipped')).toMatchObject({ id: 'qsl-plugin', reason: 'dependency' });
    });
});

describe('strict inheritance', () => {
    it('takes the flow setting, and lets the process override it', async () => {
        const core = await freshCore();
        failingType(core);
        const ran = [];

        core.setFlowOptions({ strict: true }, 'tags');
        core.add({ id: 'sdk', type: 'broken' }, 'tags');
        core.add({ id: 'inherits', depends: ['sdk'], onComplete: () => ran.push('inherits') }, 'tags');
        core.add({ id: 'overrides', depends: ['sdk'], strict: false, onComplete: () => ran.push('overrides') }, 'tags');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['overrides']);
    });

    it('falls back to the instance default', async () => {
        const core = await freshCore();
        failingType(core);
        core.strict = true;
        const ran = [];

        core.add({ id: 'sdk', type: 'broken' });
        core.add({ id: 'plugin', depends: ['sdk'], onComplete: () => ran.push('plugin') });

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual([]);
    });
});

describe('flows skipped by a condition', () => {
    it('settle their processes so dependents in other flows are released', async () => {
        const core = await freshCore();
        const events = record(core);
        const ran = [];

        core.setFlowOptions({ condition: false }, 'analytics');
        core.add({ id: 'sdk', onComplete: () => ran.push('sdk') }, 'analytics');
        core.add({ id: 'plugin', depends: ['sdk'], onComplete: () => ran.push('plugin') }, 'widgets');

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(ran).toEqual(['plugin']);
        expect(events.find((e) => e.name === 'skipped')).toMatchObject({ id: 'qsl-sdk', reason: 'condition' });
    });
});

describe('flow-level depends', () => {
    it('still runs a dependent flow after a skipped one by default', async () => {
        const core = await freshCore();
        const ran = [];

        core.setFlowOptions({ condition: false }, 'analytics');
        core.setFlowOptions({ depends: ['analytics'] }, 'marketing');
        core.add({ id: 'sdk' }, 'analytics');
        core.add({ id: 'pixel', onComplete: () => ran.push('pixel') }, 'marketing');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['pixel']);
    });

    it('skips a strict dependent flow when its dependency was skipped', async () => {
        const core = await freshCore();
        const events = record(core);
        const ran = [];

        core.setFlowOptions({ condition: false }, 'analytics');
        core.setFlowOptions({ depends: ['analytics'], strict: true }, 'marketing');
        core.setFlowOptions({ depends: ['marketing'], strict: true }, 'retargeting');
        core.add({ id: 'sdk' }, 'analytics');
        core.add({ id: 'pixel', onComplete: () => ran.push('pixel') }, 'marketing');
        core.add({ id: 'audience', onComplete: () => ran.push('audience') }, 'retargeting');

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(ran).toEqual([]);
        expect(events.filter((e) => e.name === 'skipped').map((e) => [e.id, e.reason])).toEqual([
            ['qsl-sdk', 'condition'],
            ['qsl-pixel', 'dependency'],
            ['qsl-audience', 'dependency'],
        ]);
    });

    it('skips a strict dependent flow when a process in its dependency failed', async () => {
        const core = await freshCore();
        failingType(core);
        const ran = [];

        core.setFlowOptions({ depends: ['analytics'], strict: true }, 'marketing');
        core.add({ id: 'sdk', type: 'broken' }, 'analytics');
        core.add({ id: 'ok' }, 'analytics');
        core.add({ id: 'pixel', onComplete: () => ran.push('pixel') }, 'marketing');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual([]);
    });

    it('does not count a process skipped by its own condition as a failure', async () => {
        const core = await freshCore();
        const ran = [];

        core.setFlowOptions({ depends: ['analytics'], strict: true }, 'marketing');
        core.add({ id: 'desktop-only', condition: false }, 'analytics');
        core.add({ id: 'sdk' }, 'analytics');
        core.add({ id: 'pixel', onComplete: () => ran.push('pixel') }, 'marketing');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['pixel']);
    });
});

describe('circular dependencies', () => {
    it('skip only the members of a process cycle', async () => {
        const core = await freshCore();
        const events = record(core);
        const ran = [];

        core.add({ id: 'a', depends: ['b'] });
        core.add({ id: 'b', depends: ['a'] });
        core.add({ id: 'c', depends: ['a'], onComplete: () => ran.push('c') }, 'other');

        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(events.filter((e) => e.name === 'skipped').map((e) => [e.id, e.reason])).toEqual([
            ['qsl-a', 'circular'],
            ['qsl-b', 'circular'],
        ]);
        expect(ran).toEqual(['c']);
    });

    it('skip only the members of a flow cycle', async () => {
        const core = await freshCore();
        const ran = [];

        core.setFlowOptions({ depends: ['b'] }, 'a');
        core.setFlowOptions({ depends: ['a'] }, 'b');
        core.setFlowOptions({ depends: ['a'] }, 'c');
        core.add({ id: 'in-a', onComplete: () => ran.push('a') }, 'a');
        core.add({ id: 'in-b', onComplete: () => ran.push('b') }, 'b');
        core.add({ id: 'in-c', onComplete: () => ran.push('c') }, 'c');

        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['c']);
    });
});

describe('preload', () => {
    it('emits a preload link for stylesheets as well as scripts', async () => {
        const core = await freshCore();
        core.registerType('stylesheet', () => Promise.resolve());

        core.setFlowOptions({ preload: true }, 'css');
        core.add({ id: 'theme', type: 'stylesheet', href: '/theme.css' }, 'css');
        await within(core.load());

        const link = document.querySelector('link[rel="preload"][href="/theme.css"]');
        expect(link).not.toBeNull();
        expect(link.getAttribute('as')).toBe('style');
    });

    it('passes fetchPriority on to the preload link', async () => {
        const core = await freshCore();
        core.registerType('script', () => Promise.resolve());

        core.setFlowOptions({ preload: true }, 'js');
        core.add({ id: 'low', type: 'script', src: '/low.js', fetchPriority: 'low' }, 'js');
        core.add({ id: 'plain', type: 'script', src: '/plain.js' }, 'js');
        await within(core.load());

        expect(document.querySelector('link[href="/low.js"]').getAttribute('fetchpriority')).toBe('low');
        expect(document.querySelector('link[href="/plain.js"]').hasAttribute('fetchpriority')).toBe(false);
    });
});

describe('process conditions', () => {
    it('are checked again once the trigger fires', async () => {
        const core = await freshCore();
        const events = record(core);
        let allowed = true;
        let fire = null;

        core.add({ id: 'popup', condition: () => allowed, trigger: (cb) => { fire = cb; } });
        const loading = core.load();

        /**
         * The visitor navigates away while the popup waits for its trigger.
         */
        allowed = false;
        fire();

        expect(await within(loading)).toBe('resolved');
        events.stop();
        expect(events.map((e) => [e.name, e.reason])).toEqual([['skipped', 'condition']]);
    });
});

describe('groups', () => {
    it('pauseGroup holds a flow that is already waiting for its trigger', async () => {
        const core = await freshCore();
        const ran = [];
        const fires = [];

        core.setFlowOptions({ group: 'marketing', trigger: (cb) => fires.push(cb) }, 'deferred');
        core.add({ id: 'chat', onComplete: () => ran.push('chat') }, 'deferred');
        const loading = core.load();

        /**
         * Consent withdrawn while the chat waits for interaction.
         */
        core.pauseGroup('marketing');
        fires[0]();
        await new Promise((r) => setTimeout(r, 20));
        expect(ran).toEqual([]);

        /**
         * Granted again: the trigger is armed afresh and still has to fire.
         */
        core.runGroup('marketing');
        expect(fires.length).toBe(2);
        fires[1]();

        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['chat']);
    });

    it('runGroup does not start a flow before the flows it depends on', async () => {
        const core = await freshCore();
        const order = [];

        core.setFlowOptions({ group: 'marketing', paused: true, depends: ['analytics'] }, 'pixels');
        core.add({ id: 'pixel', onComplete: () => order.push('pixel') }, 'pixels');
        core.add({ id: 'sdk', delay: 60, onComplete: () => order.push('sdk') }, 'analytics');
        const loading = core.load();

        core.runGroup('marketing');

        expect(await within(loading)).toBe('resolved');
        expect(order).toEqual(['sdk', 'pixel']);
    });

    it('a paused flow is not released when its dependency completes', async () => {
        const core = await freshCore();
        const ran = [];

        core.setFlowOptions({ group: 'marketing', depends: ['analytics'] }, 'pixels');
        core.add({ id: 'pixel', onComplete: () => ran.push('pixel') }, 'pixels');
        core.add({ id: 'sdk', delay: 30 }, 'analytics');
        core.pauseGroup('marketing');
        const loading = core.load();

        expect(await within(loading, 150)).toBe('hung');
        expect(ran).toEqual([]);

        core.runGroup('marketing');
        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['pixel']);
    });
});

describe('runFlow', () => {
    it('starts a flow that was added with paused: true', async () => {
        const core = await freshCore();
        const ran = [];

        core.setFlowOptions({ paused: true }, 'map');
        core.add({ id: 'map', onComplete: () => ran.push('map') }, 'map');
        const loading = core.load();

        expect(await within(loading, 100)).toBe('hung');
        core.runFlow('map');

        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['map']);
    });
});

describe('the same config object', () => {
    it('can be added again for the next run', async () => {
        const core = await freshCore();
        const ran = [];
        const pageView = { id: 'page-view', onComplete: () => ran.push('page-view') };

        core.add(pageView);
        expect(await within(core.load())).toBe('resolved');

        core.add(pageView);
        expect(await within(core.load())).toBe('resolved');

        expect(ran).toEqual(['page-view', 'page-view']);
        expect(pageView.id).toBe('page-view');
    });
});

describe('code that throws does not hang the run', () => {
    it('a type handler that throws settles the process as failed', async () => {
        const core = await freshCore();
        const events = record(core);
        core.registerType('throws', () => { throw new Error('boom'); });

        core.add({ id: 'bad', type: 'throws' });
        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(events.find((e) => e.name === 'error')).toMatchObject({ id: 'qsl-bad' });
    });

    it('a type handler that returns no promise completes', async () => {
        const core = await freshCore();
        core.registerType('sync', () => undefined);

        core.add({ id: 'plain', type: 'sync' });
        expect(await within(core.load())).toBe('resolved');
    });

    it('a condition that throws counts as failed', async () => {
        const core = await freshCore();
        const events = record(core);

        core.add({ id: 'x', condition: () => { throw new Error('boom'); } });
        expect(await within(core.load())).toBe('resolved');
        events.stop();

        expect(events.map((e) => [e.name, e.reason])).toEqual([['skipped', 'condition']]);
    });

    it('a trigger that throws lets the process run', async () => {
        const core = await freshCore();
        const ran = [];

        core.add({ id: 'x', trigger: () => { throw new Error('boom'); }, onComplete: () => ran.push('x') });
        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['x']);
    });

    it('flow callbacks and a process onComplete that throw', async () => {
        const core = await freshCore();
        const boom = () => { throw new Error('boom'); };

        core.setFlowOptions({ beforeStart: boom, onComplete: boom }, 'tags');
        core.add({ id: 'x', onComplete: boom }, 'tags');
        expect(await within(core.load())).toBe('resolved');
    });
});
