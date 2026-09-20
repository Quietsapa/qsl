import { describe, it, expect, beforeEach } from 'vitest';
import { Shadow, InlineScript, HTML } from '../src/types.js';
import { waitFor } from './helpers.js';

beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

describe('shadow type', () => {
    it('resolves with an Error instead of throwing when the container is missing', async () => {
        customElements.define('qs-test-missing', class extends HTMLElement {});

        const result = await Shadow.handler({
            flowId: 'default',
            id: 'qsl-missing',
            tag: 'qs-test-missing',
            shadowData: { container: '#nope' },
        }, {});

        expect(result).toBeInstanceOf(Error);
        expect(String(result.message)).toContain('#nope');
    });

    it('resolves with an Error when no container was configured at all', async () => {
        customElements.define('qs-test-nocontainer', class extends HTMLElement {});

        const result = await Shadow.handler({
            flowId: 'default',
            id: 'qsl-nocontainer',
            tag: 'qs-test-nocontainer',
            shadowData: {},
        }, {});

        expect(result).toBeInstanceOf(Error);
    });

    it('appends the element when the container exists', async () => {
        customElements.define('qs-test-ok', class extends HTMLElement {});
        document.body.innerHTML = '<div id="host"></div>';

        await Shadow.handler({
            flowId: 'default',
            id: 'qsl-ok',
            tag: 'qs-test-ok',
            shadowData: { container: '#host' },
        }, {});

        expect(document.querySelector('#host qs-test-ok')).not.toBeNull();
    });
});

describe('inline-script type', () => {
    it('escapes flow and process identifiers in the module wrapper', async () => {
        window.__QSL__ = { currentProcessPerFlow: new Map() };

        const hostile = "default'],window.__QS_PWNED__=1,[";

        /* A module script only settles once the browser has executed it, which
           happy-dom does not do. Inspect the generated source instead. */
        InlineScript.handler({
            flowId: hostile,
            id: 'qsl-inject',
            module: true,
            code: '',
        }, {});

        await waitFor(() => document.head.querySelector('script[type="module"]') !== null);

        const el = document.head.querySelector('script[type="module"]');
        const source = el.textContent;
        const count = (haystack, needle) => haystack.split(needle).length - 1;

        /* Every appearance of the hostile value sits inside a quoted JSON
           literal, so none of it is ever parsed as code. */
        expect(count(source, hostile)).toBeGreaterThan(0);
        expect(count(source, hostile)).toBe(count(source, JSON.stringify(hostile)));
        expect(source).not.toContain(`set('${hostile}'`);
    });

    it('strips script tags from inline code', async () => {
        window.__QSL__ = { currentProcessPerFlow: new Map() };

        await InlineScript.handler({
            flowId: 'default',
            id: 'qsl-strip',
            code: '<script>var a = 1;</script>',
        }, {});

        const el = document.head.querySelector('script:not([type="module"])');
        expect(el.textContent).toBe('var a = 1;');
    });
});

describe('html type', () => {
    it('renders markup into the requested tag', async () => {
        await HTML.handler({
            flowId: 'default',
            id: 'qsl-html',
            tag: 'div',
            html: '<span class="inner">hi</span>',
            className: ['a', 'b'],
        }, {});

        const el = document.head.querySelector('div.a.b');
        expect(el).not.toBeNull();
        expect(el.querySelector('.inner').textContent).toBe('hi');
    });
});
