import { describe, it, expect, beforeEach } from 'vitest';
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

        /**
         * Define the property outright rather than spying on the getter:
         * repeated spy/restore cycles on the same accessor chain onto each
         * other and eventually recurse.
         */
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

    it('keeps two processes with the same id from waking each other', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];

        /**
         * Ids are not unique: the same explicit id can be reused in a later
         * run. The first run's listener must not fire again in the second.
         */
        core.registerType('vendor', (process, callbacks) => {
            const element = document.createElement('script');
            callbacks.registerProcessElement?.(element, process);
            Object.defineProperty(document, 'currentScript', {
                value: element,
                configurable: true,
            });
            const tag = process.tag;
            document.addEventListener('DOMContentLoaded', () => hits.push(tag));
            delete document.currentScript;
            return Promise.resolve();
        });

        core.add({ id: 'vendor', type: 'vendor', tag: 'first-run' });
        await core.load();

        core.add({ id: 'vendor', type: 'vendor', tag: 'second-run' });
        await core.load();

        expect(hits).toEqual(['first-run', 'second-run']);
    });

    it('keeps a late add with a reused id from waking the earlier process', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];

        core.registerType('vendor', (process, callbacks) => {
            const element = document.createElement('script');
            callbacks.registerProcessElement?.(element, process);
            Object.defineProperty(document, 'currentScript', {
                value: element,
                configurable: true,
            });
            const tag = process.tag;
            document.addEventListener('DOMContentLoaded', () => hits.push(tag));
            delete document.currentScript;
            return new Promise((resolve) => setTimeout(resolve, process.wait || 0));
        });

        core.add({ id: 'vendor', type: 'vendor', tag: 'early', wait: 120 });
        const loading = core.load();

        await new Promise((r) => setTimeout(r, 40));
        core.add({ id: 'vendor', type: 'vendor', tag: 'late' });

        await loading;

        expect(hits).toEqual(['early', 'late']);
    });

    it('leaves listeners it cannot attribute to a process alone', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];
        core.registerType('noop', () => Promise.resolve());

        /**
         * Registered outside any process: nothing to attribute it to, so it
         * stays bound to the real event and never fires.
         */
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

    describe('addEventListener patch lifecycle', () => {
        const own = (target) => Object.prototype.hasOwnProperty.call(target, 'addEventListener');

        /**
         * The prototype that actually supplies document.addEventListener. In
         * a browser that is EventTarget.prototype; happy-dom has its own
         * chain, so look it up rather than assume.
         */
        const owner = (target) => {
            let p = target;
            while (p && !own(p)) p = Object.getPrototypeOf(p);
            return p;
        };

        /**
         * A plugin that leaked in an earlier test would leave an own property
         * on document and mask the check below. document never has one
         * natively, so start each test from the native state.
         */
        beforeEach(() => {
            if (own(document)) delete document.addEventListener;
        });

        it('restores the exact own-property state of document and window', async () => {
            /**
             * document normally inherits the method; window may or may not
             * (happy-dom defines it on the instance). Either way, the state
             * after a run must match the state before it.
             */
            const docBefore = own(document);
            expect(docBefore).toBe(false);
            const winBefore = own(window);
            const winMethod = window.addEventListener;

            const core = await freshCore();
            core.use(events);
            core.LIFECYCLE.DOMREADY = true;
            core.registerType('noop', () => Promise.resolve());

            core.add({ id: 'plain', type: 'noop' });
            await core.load();

            expect(own(document)).toBe(docBefore);
            expect(own(window)).toBe(winBefore);
            expect(window.addEventListener).toBe(winMethod);
        });

        it('lets a prototype patch installed after the run reach document', async () => {
            /**
             * Resolve the prototype before the run: afterwards, a leaked own
             * property would make document itself look like the owner.
             */
            const proto = owner(Object.getPrototypeOf(document));
            const core = await freshCore();
            core.use(events);
            core.LIFECYCLE.DOMREADY = true;
            core.registerType('noop', () => Promise.resolve());

            core.add({ id: 'plain', type: 'noop' });
            await core.load();

            /**
             * What an APM or RUM SDK loaded later does.
             */
            const native = proto.addEventListener;
            const seen = [];
            proto.addEventListener = function (type, ...rest) {
                seen.push(type);
                return native.call(this, type, ...rest);
            };
            try {
                document.addEventListener('qsl-probe', () => {});
            } finally {
                proto.addEventListener = native;
            }

            expect(seen).toEqual(['qsl-probe']);
        });

        it('does not remove a wrapper another script stacked on top during the run', async () => {
            const core = await freshCore();
            core.use(events);
            core.LIFECYCLE.DOMREADY = true;

            const hadOwn = own(document);
            let apmCalls = 0;
            let apmWrapper = null;

            core.registerType('apm', () => {
                const underneath = document.addEventListener;
                apmWrapper = function (...args) {
                    apmCalls++;
                    return underneath.apply(this, args);
                };
                document.addEventListener = apmWrapper;
                return Promise.resolve();
            });

            try {
                core.add({ id: 'apm', type: 'apm' });
                await core.load();

                expect(document.addEventListener).toBe(apmWrapper);

                /**
                 * Outside a run the plugin passes through: the real event
                 * name reaches the native method untouched.
                 */
                const hits = [];
                document.addEventListener('DOMContentLoaded', () => hits.push('outside'));
                document.dispatchEvent(new Event('DOMContentLoaded'));
                expect(hits).toEqual(['outside']);
                expect(apmCalls).toBe(1);
            } finally {
                if (hadOwn) document.addEventListener = owner(Object.getPrototypeOf(document)).addEventListener;
                else delete document.addEventListener;
            }
        });

        it('reuses its stacked wrapper and intercepts again in the next run', async () => {
            const core = await freshCore();
            core.use(events);
            core.LIFECYCLE.DOMREADY = true;

            const hadOwn = own(document);
            let apmWrapper = null;
            const hits = [];

            core.registerType('apm', () => {
                const underneath = document.addEventListener;
                apmWrapper = function (...args) {
                    return underneath.apply(this, args);
                };
                document.addEventListener = apmWrapper;
                return Promise.resolve();
            });
            registerVendorType(core, 'DOMContentLoaded', hits, 1);

            try {
                core.add({ id: 'apm', type: 'apm' });
                await core.load();

                core.add({ id: 'vendor', type: 'vendor' });
                await core.load();

                expect(hits).toEqual(['listener-0']);
                expect(document.addEventListener).toBe(apmWrapper);
            } finally {
                if (hadOwn) document.addEventListener = owner(Object.getPrototypeOf(document)).addEventListener;
                else delete document.addEventListener;
            }
        });

        it('calls the original with the receiver the caller used', async () => {
            const core = await freshCore();
            core.use(events);
            core.LIFECYCLE.DOMREADY = true;

            const receivers = [];
            const proto = owner(document);
            const native = proto.addEventListener;
            proto.addEventListener = function (...args) {
                receivers.push(this);
                return native.apply(this, args);
            };

            const other = document.createElement('div');
            try {
                core.registerType('probe', () => {
                    document.addEventListener.call(other, 'ping', () => {});
                    return Promise.resolve();
                });
                core.add({ id: 'probe', type: 'probe' });
                await core.load();
            } finally {
                proto.addEventListener = native;
            }

            expect(receivers).toContain(other);
        });
    });

    it('honours fireEvents: false on the flow', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;

        const hits = [];
        registerVendorType(core, 'DOMContentLoaded', hits, 1);

        core.setFlowOptions({ fireEvents: false }, 'quiet');
        core.add({ id: 'vendor', type: 'vendor' }, 'quiet');
        await core.load();

        expect(hits).toEqual([]);
    });

    it('leaves a listener alone when the event has not happened yet', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = false;

        const hits = [];
        registerVendorType(core, 'DOMContentLoaded', hits, 1);

        core.add({ id: 'vendor', type: 'vendor' });
        await core.load();
        expect(hits).toEqual([]);

        /**
         * The real event still reaches it, exactly once.
         */
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(hits).toEqual(['listener-0']);
    });

    it('falls back to the stack trace to find a script process', async () => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;
        const hits = [];

        /**
         * No currentScript: the listener is
         * registered from this file, so a script process whose src ends in
         * this file's name is the one it belongs to.
         */
        core.registerType('script', () => {
            document.addEventListener('DOMContentLoaded', () => hits.push('by-stack'));
            return Promise.resolve();
        });

        core.add({ id: 'vendor', type: 'script', src: 'https://cdn.example/vendor/events.test.js?v=2' });
        await core.load();

        expect(hits).toEqual(['by-stack']);
    });

    /**
     * The stack-trace fallback compares the file a listener was registered
     * from with the `src` of each script process. It is a heuristic over URLs
     * and paths, so it gets a table.
     */
    const thisFile = new URL(import.meta.url).pathname;

    it.each([
        ['a URL with query and hash', 'https://cdn.example/vendor/events.test.js?v=2#top', 'script', true],
        ['a relative path with a hash', 'vendor/events.test.js#frag', 'script', true],
        ['the bare file name', 'events.test.js', 'script', true],
        ['the exact path of the file', thisFile, 'script', true],
        ['a different file', 'https://cdn.example/vendor/other.js', 'script', false],
        ['a src that is not a valid URL', 'http://[broken/events.test.jsx', 'script', false],
        ['the right file on a type other than script', 'events.test.js', 'not-a-script', false],
    ])('by stack: %s → attributed: %s', async (_, src, type, attributed) => {
        const core = await freshCore();
        core.use(events);
        core.LIFECYCLE.DOMREADY = true;
        const hits = [];

        core.registerType(type, () => {
            document.addEventListener('DOMContentLoaded', () => hits.push('hit'));
            return Promise.resolve();
        });

        core.add({ id: 'vendor', type, src });
        await core.load();

        /**
         * An attributed listener runs on completion. One that is not stays
         * bound to the real event; fire that to clean up after the test.
         */
        expect(hits).toEqual(attributed ? ['hit'] : []);
        if (!attributed) document.dispatchEvent(new Event('DOMContentLoaded'));
    });
});

