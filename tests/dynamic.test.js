import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';

const within = (promise, ms = 500) => Promise.race([
    promise.then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('hung'), ms)),
]);

/**
 * A "mark" type that takes a controllable amount of time, so a test can add a
 * process while an earlier flow is genuinely still in flight.
 */
function registerMark(core, seen) {
    core.registerType('mark', (process) => new Promise((resolve) => {
        setTimeout(() => {
            seen.push(process.mark);
            resolve();
        }, process.wait || 0);
    }));
}

describe('processes added while a run is in progress', () => {
    it('runs a process added while an earlier flow is still running', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'early', type: 'mark', mark: 'early', wait: 120 });
        const loading = core.load();

        await new Promise((r) => setTimeout(r, 40));
        expect(core.hasStarted).toBe(true);

        core.add({ id: 'late', type: 'mark', mark: 'late' });

        await loading;

        expect(seen).toEqual(['early', 'late']);
    });

    it('runs the late process only after the regular flows finish', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'slow', type: 'mark', mark: 'slow', wait: 150 });
        const loading = core.load();

        await new Promise((r) => setTimeout(r, 30));
        core.add({ id: 'quick', type: 'mark', mark: 'quick' });

        /**
         * The late process would finish first if it were not held back.
         */
        await new Promise((r) => setTimeout(r, 60));
        expect(seen).toEqual([]);

        await loading;
        expect(seen).toEqual(['slow', 'quick']);
    });

    it('completes normally when nothing is added late', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'only', type: 'mark', mark: 'only' });
        await core.load();

        expect(seen).toEqual(['only']);
        expect(core.hasStarted).toBe(false);
    });

    it('treats a flow named like an internal one as a regular flow', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        /**
         * The old plugin recognised its flows by the substring 'dynamic' in
         * the id, so this flow was held back until the end and then run by
         * accident. It must run with the others.
         */
        core.add({ id: 'pricing', type: 'mark', mark: 'pricing', wait: 20 }, 'dynamic-pricing');
        core.add({ id: 'slow', type: 'mark', mark: 'slow', wait: 80 });
        await core.load();

        expect(seen).toEqual(['pricing', 'slow']);
    });

    it('runs late adds one flow at a time, in the order they were added', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'early', type: 'mark', mark: 'early', wait: 60 });
        const loading = core.load();

        core.add({ id: 'first', type: 'mark', mark: 'first', wait: 40 });
        core.add({ id: 'second', type: 'mark', mark: 'second', wait: 0 });

        await loading;
        expect(seen).toEqual(['early', 'first', 'second']);
    });

    it('runs a named flow that is created during the run', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'early', type: 'mark', mark: 'early', wait: 60 });
        const loading = core.load();

        /**
         * Nothing would ever start this flow: it did not exist when the run
         * began. Before, load() never resolved.
         */
        core.add({ id: 'chat', type: 'mark', mark: 'chat' }, 'chat');

        expect(await within(loading)).toBe('resolved');
        expect(seen).toEqual(['early', 'chat']);
    });

    it('keeps the options of a flow created during the run', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);
        let fire = null;

        core.add({ id: 'early', type: 'mark', mark: 'early' });
        const loading = core.load();

        core.setFlowOptions({ trigger: (cb) => { fire = cb; } }, 'chat');
        core.add({ id: 'chat', type: 'mark', mark: 'chat' }, 'chat');

        expect(await within(loading, 100)).toBe('hung');
        expect(seen).toEqual(['early']);

        fire();
        expect(await within(loading)).toBe('resolved');
        expect(seen).toEqual(['early', 'chat']);
    });

    it('does not let a paused late flow hold up the ones after it', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'early', type: 'mark', mark: 'early', wait: 20 });
        const loading = core.load();

        core.setFlowOptions({ paused: true }, 'map');
        core.add({ id: 'map', type: 'mark', mark: 'map' }, 'map');
        core.add({ id: 'pixel', type: 'mark', mark: 'pixel' });

        expect(await within(loading, 120)).toBe('hung');
        expect(seen).toEqual(['early', 'pixel']);

        core.runFlow('map');
        expect(await within(loading)).toBe('resolved');
        expect(seen).toEqual(['early', 'pixel', 'map']);
    });

    it('runs a process added to a flow that has already started', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'first', type: 'mark', mark: 'first', wait: 60 }, 'tags');
        const loading = core.load();

        /**
         * 'tags' is running from the list it had when it started.
         */
        core.add({ id: 'second', type: 'mark', mark: 'second' }, 'tags');

        expect(await within(loading)).toBe('resolved');
        expect(seen).toEqual(['first', 'second']);
    });

    it('carries the condition and group of the started flow over', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);
        let allowed = true;

        core.setFlowOptions({ condition: () => allowed, group: 'marketing' }, 'tags');
        core.add({ id: 'first', type: 'mark', mark: 'first', wait: 40 }, 'tags');
        const loading = core.load();

        core.add({ id: 'second', type: 'mark', mark: 'second' }, 'tags');
        core.add({ id: 'third', type: 'mark', mark: 'third' }, 'tags');

        /**
         * pauseGroup and runGroup reach the late flows too.
         */
        expect(core.inGroup('marketing').length).toBe(3);

        /**
         * The same condition decides for the late flows, checked when they run.
         */
        allowed = false;

        expect(await within(loading)).toBe('resolved');
        expect(seen).toEqual(['first']);
    });
});
