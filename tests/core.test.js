import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';

describe('registerType / registerTypes', () => {
    it('keeps the instance chainable even for invalid input', async () => {
        const core = await freshCore();
        expect(core.registerType(null, null)).toBe(core);
        expect(core.registerTypes(null)).toBe(core);
    });

    it('accepts both the array and the object form', async () => {
        const core = await freshCore();
        const handler = () => Promise.resolve();

        core.registerTypes([{ type: 'from-array', handler }]);
        core.registerTypes({ 'from-object': handler });

        expect(core.types.has('from-array')).toBe(true);
        expect(core.types.has('from-object')).toBe(true);
    });
});

describe('flow execution', () => {
    it('runs an ordered flow in insertion order', async () => {
        const core = await freshCore();
        const seen = [];

        core.registerType('mark', (process) => {
            seen.push(process.mark);
            return Promise.resolve();
        });

        core.add({ id: 'a', type: 'mark', mark: 'a' }, 'seq');
        core.add({ id: 'b', type: 'mark', mark: 'b' }, 'seq');
        core.add({ id: 'c', type: 'mark', mark: 'c' }, 'seq');
        core.setFlowOptions({ ordered: true }, 'seq');

        await core.load();

        expect(seen).toEqual(['a', 'b', 'c']);
    });

    it('skips a process whose condition fails', async () => {
        const core = await freshCore();
        const seen = [];

        core.registerType('mark', (process) => {
            seen.push(process.mark);
            return Promise.resolve();
        });

        core.add({ id: 'yes', type: 'mark', mark: 'yes', condition: () => true });
        core.add({ id: 'no', type: 'mark', mark: 'no', condition: () => false });

        await core.load();

        expect(seen).toEqual(['yes']);
    });

    it('waits for a process dependency before running', async () => {
        const core = await freshCore();
        const seen = [];

        core.registerType('mark', (process) => {
            seen.push(process.mark);
            return Promise.resolve();
        });

        core.add({ id: 'second', type: 'mark', mark: 'second', depends: ['first'] });
        core.add({ id: 'first', type: 'mark', mark: 'first' });

        await core.load();

        expect(seen).toEqual(['first', 'second']);
    });
});

describe('reset and destroy', () => {
    it('exposes a SKIPPED event so fire() is not a silent no-op', async () => {
        const core = await freshCore();
        expect(core.EVENTS.SKIPPED).toBeTruthy();

        core.useEvents();
        let fired = false;
        window.addEventListener(core.EVENTS.SKIPPED, () => { fired = true; });
        core.fire('SKIPPED', { id: 'x' });

        expect(fired).toBe(true);
    });

    it('keeps registered types and handlers across an automatic reset', async () => {
        const core = await freshCore();

        core.registerType('mark', () => Promise.resolve());
        core.conditionHandlers.add(() => null);
        const handlerCount = core.conditionHandlers.size;

        core.add({ id: 'a', type: 'mark' });
        await core.load();

        /* The run is over and state is cleared ... */
        expect(core.flows.size).toBe(0);
        expect(core.hasStarted).toBe(false);

        /* ... but the plugin surface survives, so a second run behaves the same. */
        expect(core.types.has('mark')).toBe(true);
        expect(core.conditionHandlers.size).toBe(handlerCount);
    });

    it('runs a second load cycle after the first one completed', async () => {
        const core = await freshCore();
        const seen = [];

        core.registerType('mark', (process) => {
            seen.push(process.mark);
            return Promise.resolve();
        });

        core.add({ id: 'first', type: 'mark', mark: 'first' });
        await core.load();

        core.add({ id: 'second', type: 'mark', mark: 'second' });
        await core.load();

        expect(seen).toEqual(['first', 'second']);
    });

    it('destroy() tears the plugin surface down as well', async () => {
        const core = await freshCore();

        core.registerType('mark', () => Promise.resolve());
        core.conditionHandlers.add(() => null);

        core.destroy();

        expect(core.types.size).toBe(0);
        expect(core.conditionHandlers.size).toBe(0);
        expect(core.initialized).toBe(false);
    });

    it('does not reset automatically when autoReset is off', async () => {
        const core = await freshCore();
        core.autoReset = false;

        core.registerType('mark', () => Promise.resolve());
        core.add({ id: 'a', type: 'mark' }, 'kept');

        await core.load();

        expect(core.flows.has('kept')).toBe(true);
    });
});
