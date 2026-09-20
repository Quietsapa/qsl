import { describe, it, expect } from 'vitest';
import { freshCore } from './helpers.js';
import events from '../src/plugins/events.js';

/**
 * The events plugin gives a late-loading process its own DOMContentLoaded and
 * load events, so a vendor script that registers a listener after the real
 * event has fired still initialises.
 *
 * The contract that matters to a vendor is exactness: its callback has to run,
 * and it has to run once. Firing twice means two page views, two widgets, two
 * conversions.
 */

/**
 * A type that behaves like a vendor script: it claims its own element through
 * the plugin's registerProcessElement callback, pretends to be the currently
 * executing script, and registers listeners the way vendor code does.
 *
 * @param {Object} core
 * @param {string} event - 'DOMContentLoaded' or 'load'
 * @param {Array} hits - collects the names of callbacks that ran
 * @param {number} listenerCount - how many listeners this vendor registers
 */
function registerVendorType(core, event, hits, listenerCount) {
    const target = event === 'load' ? window : document;

    core.registerType('vendor', (process, callbacks) => {
        const element = document.createElement('script');
        callbacks.registerProcessElement?.(element, process);

        /* Define the property outright rather than spying on the getter:
           repeated spy/restore cycles on the same accessor chain onto each
           other and eventually recurse. */
        Object.defineProperty(document, 'currentScript', {
            value: element,
            configurable: true,
        });

        for (let i = 0; i < listenerCount; i++) {
            const name = 'listener-' + i;
            target.addEventListener(event, () => hits.push(name));
        }

        delete document.currentScript;
        return Promise.resolve();
    });
}

describe('events plugin', () => {
    it('runs a late DOMContentLoaded listener exactly once', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];
        registerVendorType(core, 'DOMContentLoaded', hits, 1);

        core.add({ id: 'vendor', type: 'vendor' });
        await core.load();

        expect(hits).toEqual(['listener-0']);
    });

    it('runs each of several listeners from one process exactly once', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];
        registerVendorType(core, 'DOMContentLoaded', hits, 3);

        core.add({ id: 'vendor', type: 'vendor' });
        await core.load();

        expect(hits.sort()).toEqual(['listener-0', 'listener-1', 'listener-2']);
    });

    it('does the same for a late window load listener', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.LOADED = true;

        const hits = [];
        registerVendorType(core, 'load', hits, 2);

        core.add({ id: 'vendor', type: 'vendor' });
        await core.load();

        expect(hits.sort()).toEqual(['listener-0', 'listener-1']);
    });

    it('leaves listeners it cannot attribute to a process alone', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];
        core.registerType('noop', () => Promise.resolve());

        /* Registered outside any process: nothing to attribute it to, so it
           stays bound to the real event and never fires. */
        document.addEventListener('DOMContentLoaded', () => hits.push('unmanaged'));

        core.add({ id: 'plain', type: 'noop' });
        await core.load();

        expect(hits).toEqual([]);
    });

    it('honours fireEvents: false on the process', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];
        registerVendorType(core, 'DOMContentLoaded', hits, 1);

        core.add({ id: 'vendor', type: 'vendor', fireEvents: false });
        await core.load();

        expect(hits).toEqual([]);
    });
});
