import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';
import dynamic from '../src/plugins/dynamic.js';

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

describe('dynamic plugin', () => {
    it('runs a process added while an earlier flow is still running', async () => {
        const core = await freshCore();
        core.use(dynamic);

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
        core.use(dynamic);

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'slow', type: 'mark', mark: 'slow', wait: 150 });
        const loading = core.load();

        await new Promise((r) => setTimeout(r, 30));
        core.add({ id: 'quick', type: 'mark', mark: 'quick' });

        /* The late process would finish first if it were not held back. */
        await new Promise((r) => setTimeout(r, 60));
        expect(seen).toEqual([]);

        await loading;
        expect(seen).toEqual(['slow', 'quick']);
    });

    it('ignores a late add when the plugin is not registered', async () => {
        const core = await freshCore();

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'early', type: 'mark', mark: 'early', wait: 120 });
        const loading = core.load();

        await new Promise((r) => setTimeout(r, 40));
        core.add({ id: 'late', type: 'mark', mark: 'late' });

        await loading;

        expect(seen).toEqual(['early']);
    });

    it('completes normally when nothing is added late', async () => {
        const core = await freshCore();
        core.use(dynamic);

        const seen = [];
        registerMark(core, seen);

        core.add({ id: 'only', type: 'mark', mark: 'only' });
        await core.load();

        expect(seen).toEqual(['only']);
        expect(core.hasStarted).toBe(false);
    });
});
