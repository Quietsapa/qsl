import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';
import { urlCondition, mediaQueryCondition } from '../src/plugins/conditions.js';

/**
 * Paths through the core that the other suites leave out: string conditions
 * resolved through plugins, preload details, the order flows start in, late
 * flows with dependencies, and triggers that misbehave.
 */

const within = (promise, ms = 500) => Promise.race([
    promise.then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('hung'), ms)),
]);

async function setup() {
    const core = await freshCore();
    const ran = [];
    core.registerType('mark', (p) => { ran.push(p.id.replace(/^qsl-/, '')); });
    return { core, ran };
}

describe('string conditions through the core', () => {
    it('are decided by the plugin that knows the form', async () => {
        const { core, ran } = await setup();
        core.use(urlCondition).use(mediaQueryCondition);
        const here = location.href;

        core.add({ id: 'yes', type: 'mark', condition: 'url:contains:' + here.slice(0, 8) });
        core.add({ id: 'no', type: 'mark', condition: 'url:contains:not-this-page' });
        await core.load();

        expect(ran).toEqual(['yes']);
    });

    it('ask each handler in turn, and a handler that returns null passes it on', async () => {
        const { core, ran } = await setup();
        const asked = [];
        core.conditionHandlers.add((c) => { asked.push('first'); return null; });
        core.conditionHandlers.add((c) => { asked.push('second'); return c === 'custom:fail'; });

        core.add({ id: 'pass', type: 'mark', condition: 'custom:pass' });
        core.add({ id: 'fail', type: 'mark', condition: 'custom:fail' });
        await core.load();

        expect(ran).toEqual(['pass']);
        expect(asked.slice(0, 2)).toEqual(['first', 'second']);
    });

    it('run when no handler knows the form, and a non-function in the set is ignored', async () => {
        const { core, ran } = await setup();
        core.conditionHandlers.add('not a function');

        core.add({ id: 'x', type: 'mark', condition: 'nobody:knows' });
        await core.load();

        expect(ran).toEqual(['x']);
    });
});

describe('preload', () => {
    it('leaves out processes with a trigger of their own, and carries crossOrigin over', async () => {
        const core = await freshCore();
        core.registerType('script', () => {});
        core.setFlowOptions({ preload: true }, 'js');
        core.add({ id: 'now', type: 'script', src: '/now.js', crossOrigin: 'anonymous' }, 'js');
        core.add({ id: 'later', type: 'script', src: '/later.js', trigger: 'nobody:knows' }, 'js');
        await within(core.load());

        const link = document.querySelector('link[rel="preload"][href="/now.js"]');
        expect(link.crossOrigin).toBe('anonymous');
        expect(document.querySelector('link[href="/later.js"]')).toBeNull();
    });
});

describe('the order flows start in', () => {
    it('flows without a trigger first, whatever order they were added in', async () => {
        const { core, ran } = await setup();
        core.setFlowOptions({ trigger: (release) => release() }, 'triggered');
        core.add({ id: 'triggered', type: 'mark' }, 'triggered');
        core.add({ id: 'plain', type: 'mark' }, 'plain');
        await core.load();

        expect(ran).toEqual(['plain', 'triggered']);
    });
});

describe('late flows', () => {
    it('wait for the flows they depend on', async () => {
        const core = await freshCore();
        const ran = [];
        let finishSlow;
        core.registerType('slow', () => new Promise((r) => { finishSlow = () => { ran.push('slow'); r(); }; }));
        core.registerType('mark', (p) => {
            ran.push(p.id.replace(/^qsl-/, ''));
            if (p.id === 'qsl-first') {
                core.setFlowOptions({ depends: ['slow'] }, 'late');
                core.add({ id: 'late', type: 'mark' }, 'late');
            }
        });
        core.add({ id: 'first', type: 'mark' }, 'first');
        core.add({ id: 's', type: 'slow' }, 'slow');
        const loading = core.load();

        await new Promise((r) => setTimeout(r, 20));
        expect(ran).toEqual(['first']);
        finishSlow();
        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['first', 'slow', 'late']);
    });
});

describe('late flows depending on late flows', () => {
    it('start in dependency order, once the regular flows are done', async () => {
        const core = await freshCore();
        const ran = [];
        core.registerType('mark', (p) => {
            ran.push(p.id.replace(/^qsl-/, ''));
            if (p.id === 'qsl-first') {
                core.setFlowOptions({ depends: ['late-a'] }, 'late-b');
                core.add({ id: 'b', type: 'mark' }, 'late-b');
                core.add({ id: 'a', type: 'mark' }, 'late-a');
            }
        });
        core.add({ id: 'first', type: 'mark' }, 'first');
        expect(await within(core.load())).toBe('resolved');

        expect(ran).toEqual(['first', 'a', 'b']);
    });
});

describe('triggers that misbehave', () => {
    it('a flow trigger that fires twice runs the flow once', async () => {
        const { core, ran } = await setup();
        core.setFlowOptions({ trigger: (release) => { release(); release(); } }, 'f');
        core.add({ id: 'x', type: 'mark' }, 'f');
        await core.load();

        expect(ran).toEqual(['x']);
    });

    it('a flow waiting for its trigger is not armed a second time by runFlow()', async () => {
        const { core, ran } = await setup();
        let armed = 0;
        let release;
        core.setFlowOptions({ trigger: (r) => { armed++; release = r; } }, 'f');
        core.add({ id: 'x', type: 'mark' }, 'f');
        const loading = core.load();

        core.runFlow('f');
        expect(armed).toBe(1);
        release();
        expect(await within(loading)).toBe('resolved');
        expect(ran).toEqual(['x']);
    });

    it('an operator whose triggers are not a list is no trigger at all', async () => {
        const { core, ran } = await setup();
        core.add({ id: 'x', type: 'mark', trigger: { operator: 'or', triggers: 'load' } });
        core.setFlowOptions({ trigger: { operator: 'and', triggers: 'idle' } }, 'f');
        core.add({ id: 'y', type: 'mark' }, 'f');
        expect(await within(core.load())).toBe('resolved');

        expect(ran.sort()).toEqual(['x', 'y']);
    });
});

describe('guards', () => {
    it('runFlow() on a flow that does not exist or has started does nothing', async () => {
        const { core, ran } = await setup();
        core.add({ id: 'x', type: 'mark' }, 'f');
        expect(core.runFlow('nope')).toBe(core);
        const loading = core.load();
        core.runFlow('f');
        await loading;
        expect(ran).toEqual(['x']);
    });

    it('setFlowOptions() with something other than an object only creates the flow', async () => {
        const core = await freshCore();
        core.setFlowOptions(null, 'f');
        expect(core.flowOptions.get('f').status).toBe('READY');
    });

    it('maybeComplete() outside a run does nothing', async () => {
        const core = await freshCore();
        let called = false;
        core.setOnAllComplete(() => { called = true; });
        core.maybeComplete();
        expect(called).toBe(false);
    });

    it('non-functions among the plugin hooks are skipped', async () => {
        const { core, ran } = await setup();
        for (const hooks of [core.loadActions, core.addProcessFilters, core.flowIdFilters, core.processCompleteActions,
            core.allCompleteActions, core.resetActions, core.handlerCallbacksFilters, core.triggerHandlers]) {
            hooks.add(42);
        }
        core.handlerCallbacksFilters.add(() => null);
        core.add({ id: 'x', type: 'mark', trigger: 'nobody:knows' });
        expect(await within(core.load())).toBe('resolved');
        expect(ran).toEqual(['x']);
    });
});
