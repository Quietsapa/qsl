import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    interactionTrigger,
    loadTrigger,
    idleTrigger,
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
        /**
         * DOMContentLoaded has already fired at this point, so a listener
         * registered now would never run.
         */
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

describe('interaction trigger', () => {
    it('handles both the string and true', () => {
        expect(resolveTrigger(interactionTrigger, 'interaction')).toBeTypeOf('function');
        expect(resolveTrigger(interactionTrigger, true)).toBeTypeOf('function');
        expect(resolveTrigger(interactionTrigger, 'idle')).toBeNull();
    });

    it('calls back once for the first interaction of any kind', () => {
        let calls = 0;
        resolveTrigger(interactionTrigger, 'interaction')(() => calls++);

        for (const type of ['mousemove', 'click', 'keydown', 'wheel']) {
            window.dispatchEvent(new Event(type));
        }

        expect(calls).toBe(1);
    });
});

describe('every trigger handler', () => {
    it.each([
        ['interaction', interactionTrigger, 'idle'],
        ['load', loadTrigger, 'domready'],
        ['idle', idleTrigger, 'load'],
        ['domready', domReadyTrigger, 'load'],
        ['delay', delayTrigger, 'hover:#x'],
        ['hover', hoverTrigger, 'visible:#x'],
        ['visible', visibleTrigger, 'appears:#x'],
        ['appears', appearsTrigger, 'media:(min-width: 1px)'],
        ['media', mediaQueryTrigger, 'delay:10'],
    ])('%s ignores options it does not own', (_, handler, foreign) => {
        expect(resolveTrigger(handler, foreign)).toBeNull();
        expect(resolveTrigger(handler, () => {})).toBeNull();
        expect(resolveTrigger(handler, { operator: 'or', triggers: [] })).toBeNull();
    });
});

describe('load trigger', () => {
    it('fires at once when the page has already loaded', () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
        let fired = false;
        resolveTrigger(loadTrigger, 'load')(() => { fired = true; });
        expect(fired).toBe(true);
    });

    it('waits for the window load event otherwise', () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
        let fired = false;
        resolveTrigger(loadTrigger, 'load')(() => { fired = true; });
        expect(fired).toBe(false);

        window.dispatchEvent(new Event('load'));
        expect(fired).toBe(true);
    });
});

describe('domready trigger, before the document is parsed', () => {
    it('waits for DOMContentLoaded', () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        let fired = false;
        resolveTrigger(domReadyTrigger, 'domready')(() => { fired = true; });
        expect(fired).toBe(false);

        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(fired).toBe(true);
    });
});

describe('idle trigger', () => {
    it('uses requestIdleCallback when there is one', () => {
        let scheduled = null;
        vi.stubGlobal('requestIdleCallback', (cb) => { scheduled = cb; });

        let fired = false;
        resolveTrigger(idleTrigger, 'idle')(() => { fired = true; });
        expect(fired).toBe(false);

        scheduled();
        expect(fired).toBe(true);
    });

    it('falls back to a 200 ms timeout without it', () => {
        vi.useFakeTimers();
        try {
            vi.stubGlobal('requestIdleCallback', undefined);
            let fired = false;
            resolveTrigger(idleTrigger, 'idle')(() => { fired = true; });

            vi.advanceTimersByTime(199);
            expect(fired).toBe(false);
            vi.advanceTimersByTime(1);
            expect(fired).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('delay trigger, odd values', () => {
    it.each([
        ['delay:abc'],
        ['delay:'],
        ['delay:-50'],
    ])('%s fires on the next tick', (opt) => {
        vi.useFakeTimers();
        try {
            let fired = false;
            resolveTrigger(delayTrigger, opt)(() => { fired = true; });
            expect(fired).toBe(false);
            vi.advanceTimersByTime(0);
            expect(fired).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('selector triggers', () => {
    it.each([
        ['hover:', hoverTrigger],
        ['visible:', visibleTrigger],
        ['appears:', appearsTrigger],
    ])('%s with an invalid selector fires at once rather than hanging', (prefix, handler) => {
        let fired = false;
        resolveTrigger(handler, prefix + '[[[')(() => { fired = true; });
        expect(fired).toBe(true);
    });

    it('hover waits for an element that is inserted later', async () => {
        let fired = false;
        resolveTrigger(hoverTrigger, 'hover:#late')(() => { fired = true; });

        const el = document.createElement('button');
        el.id = 'late';
        document.body.appendChild(el);
        await waitFor(() => document.getElementById('late'));
        await new Promise((r) => setTimeout(r, 0));

        el.dispatchEvent(new Event('mouseover', { bubbles: true }));
        expect(fired).toBe(true);
    });

    it('hover fires only once', () => {
        document.body.innerHTML = '<button id="b"></button>';
        let calls = 0;
        resolveTrigger(hoverTrigger, 'hover:#b')(() => calls++);

        const el = document.getElementById('b');
        el.dispatchEvent(new Event('mouseover'));
        el.dispatchEvent(new Event('mouseover'));
        expect(calls).toBe(1);
    });

    it('visible fires at once without IntersectionObserver', () => {
        document.body.innerHTML = '<div id="t"></div>';
        vi.stubGlobal('IntersectionObserver', undefined);
        let fired = false;
        resolveTrigger(visibleTrigger, 'visible:#t')(() => { fired = true; });
        expect(fired).toBe(true);
    });

    it('visible ignores entries that are not intersecting', () => {
        document.body.innerHTML = '<div id="t"></div>';
        let callback = null;
        vi.stubGlobal('IntersectionObserver', class { constructor(cb) { callback = cb; } observe() {} disconnect() {} });

        let fired = false;
        resolveTrigger(visibleTrigger, 'visible:#t')(() => { fired = true; });
        callback([{ isIntersecting: false }]);
        expect(fired).toBe(false);
        callback([{ isIntersecting: false }, { isIntersecting: true }]);
        expect(fired).toBe(true);
    });
});

describe('media trigger, edge cases', () => {
    it('ignores a change that does not match', () => {
        let changeHandler = null;
        vi.stubGlobal('matchMedia', () => ({
            matches: false,
            addEventListener(_, handler) { changeHandler = handler; },
            removeEventListener() {},
        }));

        let fired = false;
        resolveTrigger(mediaQueryTrigger, 'media:(min-width: 768px)', {})(() => { fired = true; });
        changeHandler({ matches: false });
        expect(fired).toBe(false);
    });

    it.each([
        ['an empty query', 'media:', true],
        ['no matchMedia', 'media:(min-width: 1px)', false],
    ])('marks the process skipped with %s', (_, opt, hasMatchMedia) => {
        if (!hasMatchMedia) vi.stubGlobal('matchMedia', undefined);
        const process = {};
        let fired = false;
        resolveTrigger(mediaQueryTrigger, opt, process)(() => { fired = true; });
        expect(fired).toBe(true);
        expect(process.skipped).toBe(true);
    });
});

describe('selector triggers without MutationObserver', () => {
    it.each([
        ['hover:#absent', hoverTrigger],
        ['visible:#absent', visibleTrigger],
        ['appears:#absent', appearsTrigger],
    ])('%s fires at once rather than waiting forever', (opt, handler) => {
        vi.stubGlobal('MutationObserver', undefined);
        let fired = false;
        resolveTrigger(handler, opt)(() => { fired = true; });
        expect(fired).toBe(true);
    });
});

