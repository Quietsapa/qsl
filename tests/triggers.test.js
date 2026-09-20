import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    delayTrigger,
    domReadyTrigger,
    hoverTrigger,
    appearsTrigger,
    visibleTrigger,
    mediaQueryTrigger,
} from '../src/plugins/triggers.js';
import { resolveTrigger, waitFor } from './helpers.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('delay trigger', () => {
    it('fires after the given number of milliseconds', async () => {
        const trigger = resolveTrigger(delayTrigger, 'delay:10');
        expect(trigger).toBeTypeOf('function');

        let fired = false;
        trigger(() => { fired = true; });

        await waitFor(() => fired);
        expect(fired).toBe(true);
    });
});

describe('domready trigger', () => {
    it('fires immediately when the document is already interactive', async () => {
        /* DOMContentLoaded has already fired at this point, so a listener
           registered now would never run. */
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');

        const trigger = resolveTrigger(domReadyTrigger, 'domready');
        let fired = false;
        trigger(() => { fired = true; });

        expect(fired).toBe(true);
    });
});

describe('hover trigger', () => {
    it('keeps selectors that contain a colon intact', async () => {
        document.body.innerHTML = '<ul><li class="btn" id="first">a</li><li class="btn">b</li></ul>';

        const trigger = resolveTrigger(hoverTrigger, 'hover:.btn:first-child');
        expect(trigger).toBeTypeOf('function');

        let fired = false;
        trigger(() => { fired = true; });

        await waitFor(() => document.getElementById('first') !== null);
        document.getElementById('first').dispatchEvent(new Event('mouseover', { bubbles: true }));

        expect(fired).toBe(true);
    });
});

describe('appears trigger', () => {
    it('fires for an element that is already present', async () => {
        document.body.innerHTML = '<div id="here"></div>';

        const trigger = resolveTrigger(appearsTrigger, 'appears:#here');
        let fired = false;
        trigger(() => { fired = true; });

        await waitFor(() => fired);
        expect(fired).toBe(true);
    });

    it('waits for an element inserted later instead of firing immediately', async () => {
        const trigger = resolveTrigger(appearsTrigger, 'appears:#later');

        let fired = false;
        trigger(() => { fired = true; });

        expect(fired).toBe(false);

        const el = document.createElement('div');
        el.id = 'later';
        document.body.appendChild(el);

        await waitFor(() => fired);
        expect(fired).toBe(true);
    });
});

describe('visible trigger', () => {
    it('uses IntersectionObserver rather than a non-existent DOM event', async () => {
        document.body.innerHTML = '<div id="target"></div>';

        let captured = null;
        class FakeObserver {
            constructor(cb) { captured = cb; }
            observe() {}
            disconnect() {}
        }
        vi.stubGlobal('IntersectionObserver', FakeObserver);

        const trigger = resolveTrigger(visibleTrigger, 'visible:#target');
        let fired = false;
        trigger(() => { fired = true; });

        await waitFor(() => captured !== null);
        expect(fired).toBe(false);

        captured([{ isIntersecting: true }]);
        expect(fired).toBe(true);
    });
});

describe('media trigger', () => {
    it('passes the query through to matchMedia instead of skipping', async () => {
        const seen = [];
        vi.stubGlobal('matchMedia', (query) => {
            seen.push(query);
            return {
                matches: true,
                addEventListener() {},
                removeEventListener() {},
            };
        });

        const process = {};
        const trigger = resolveTrigger(mediaQueryTrigger, 'media:(min-width: 768px)', process);

        let fired = false;
        trigger(() => { fired = true; });

        expect(seen).toEqual(['(min-width: 768px)']);
        expect(fired).toBe(true);
        expect(process.skipped).toBeUndefined();
    });

    it('fires later when the query starts matching', async () => {
        let changeHandler = null;
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener(_, handler) { changeHandler = handler; },
            removeEventListener() {},
        }));

        const trigger = resolveTrigger(mediaQueryTrigger, 'media:(min-width: 768px)', {});
        let fired = false;
        trigger(() => { fired = true; });

        expect(fired).toBe(false);

        changeHandler({ matches: true });
        expect(fired).toBe(true);
    });
});
