import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Trusted Types: QSL's own policy, `qsl`, for a script's code and URL and for
 * innerHTML. The policy is created once per copy of the module, so each test
 * imports a fresh one. scripts/e2e.mjs runs the real thing in Chromium.
 */

afterEach(() => {
    delete window.trustedTypes;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
});

async function freshTypes() {
    vi.resetModules();
    return import('../src/types.js');
}

const base = (extra) => ({ flowId: 'default', id: 'qsl-t', ...extra });

/**
 * A stand-in for window.trustedTypes that records what goes through it.
 */
function fakeTrustedTypes() {
    const seen = [];
    const createPolicy = vi.fn((name, rules) => ({
        createScript: (v) => { seen.push(['script', v]); return rules.createScript(v); },
        createScriptURL: (v) => { seen.push(['url', v]); return rules.createScriptURL(v); },
        createHTML: (v) => { seen.push(['html', v]); return rules.createHTML(v); },
    }));
    window.trustedTypes = { createPolicy };
    return { createPolicy, seen };
}

describe('Trusted Types', () => {
    it('passes script code, script URLs and markup through a policy named qsl, created once', async () => {
        const { createPolicy, seen } = fakeTrustedTypes();
        const { Script, InlineScript, HTML } = await freshTypes();

        Script.handler(base({ id: 'qsl-s', src: '/a.js' }), {});
        await InlineScript.handler(base({ id: 'qsl-i', code: 'window.x = 1;' }), {});
        await HTML.handler(base({ id: 'qsl-h', tag: 'div', html: '<b>hi</b>' }), {});
        await new Promise((r) => setTimeout(r, 0));

        expect(createPolicy).toHaveBeenCalledTimes(1);
        expect(createPolicy.mock.calls[0][0]).toBe('qsl');
        expect(seen).toEqual([['url', '/a.js'], ['script', 'window.x = 1;'], ['html', '<b>hi</b>']]);
        expect(document.querySelector('script[src="/a.js"]')).not.toBeNull();
        expect(document.querySelector('div b').textContent).toBe('hi');
    });

    it('does not sanitise: the policy returns what it was given', async () => {
        const { createPolicy } = fakeTrustedTypes();
        await freshTypes().then(({ HTML }) => HTML.handler(base({ tag: 'div', html: '<img src=x onerror="void 0">' }), {}));
        const rules = createPolicy.mock.calls[0][1];
        expect(rules.createHTML('<img onerror=1>')).toBe('<img onerror=1>');
        expect(rules.createScript('a()')).toBe('a()');
        expect(rules.createScriptURL('//x/y.js')).toBe('//x/y.js');
    });

    it('leaves the stylesheet, style and pixel types alone: they are not Trusted Types sinks', async () => {
        const { seen } = fakeTrustedTypes();
        const { Stylesheet, InlineStyle, Pixel } = await freshTypes();
        Stylesheet.handler(base({ id: 'qsl-c', href: '/a.css' }), {});
        await InlineStyle.handler(base({ id: 'qsl-st', code: 'b{}' }), {});
        Pixel.handler(base({ id: 'qsl-p', src: '/p.gif' }), {});
        await new Promise((r) => setTimeout(r, 0));
        expect(seen).toEqual([]);
    });

    it('uses plain strings when the page does not allow the policy', async () => {
        window.trustedTypes = { createPolicy: vi.fn(() => { throw new TypeError('Policy "qsl" disallowed.'); }) };
        const { InlineScript } = await freshTypes();

        await InlineScript.handler(base({ code: 'window.__tt = 1;' }), {});
        await InlineScript.handler(base({ id: 'qsl-2', code: 'window.__tt = 2;' }), {});

        expect(window.trustedTypes.createPolicy).toHaveBeenCalledTimes(1);
        expect([...document.querySelectorAll('script')].map((s) => s.textContent)).toEqual(['window.__tt = 1;', 'window.__tt = 2;']);
    });

    it('uses plain strings in a browser without Trusted Types', async () => {
        const { HTML } = await freshTypes();
        await HTML.handler(base({ tag: 'section', html: '<i>ok</i>' }), {});
        expect(document.querySelector('section i').textContent).toBe('ok');
    });
});
