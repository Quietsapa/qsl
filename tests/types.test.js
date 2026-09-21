import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Shadow, InlineScript, HTML, Script, Stylesheet, InlineStyle, Pixel } from '../src/types.js';
import { waitFor } from './helpers.js';

beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});

describe('shadow type', () => {
    it('rejects with an Error when the container is missing', async () => {
        customElements.define('qs-test-missing', class extends HTMLElement {});

        const result = await Shadow.handler({
            flowId: 'default',
            id: 'qsl-missing',
            tag: 'qs-test-missing',
            shadowData: { container: '#nope' },
        }, {}).then(() => null, (e) => e);

        expect(result).toBeInstanceOf(Error);
        expect(String(result.message)).toContain('#nope');
    });

    it('rejects with an Error when no container was configured at all', async () => {
        customElements.define('qs-test-nocontainer', class extends HTMLElement {});

        const result = await Shadow.handler({
            flowId: 'default',
            id: 'qsl-nocontainer',
            tag: 'qs-test-nocontainer',
            shadowData: {},
        }, {}).then(() => null, (e) => e);

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

        /**
         * A module script only settles once the browser has executed it, which
         * happy-dom does not do. Inspect the generated source instead.
         */
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

        /**
         * Every appearance of the hostile value sits inside a quoted JSON
         * literal, so none of it is ever parsed as code.
         */
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

/**
 * A minimal config: render() needs a flow, a tag and an id to do anything.
 */
const base = (extra = {}) => ({ flowId: 'default', id: 'qsl-t', ...extra });

/**
 * Make the next element appended to `parent` fail to load, the way a 404 or
 * a blocked request does.
 */
function failNextAppend(parent = document.head) {
    const original = parent.appendChild.bind(parent);
    vi.spyOn(parent, 'appendChild').mockImplementationOnce((el) => {
        queueMicrotask(() => el.onerror?.(new Event('error')));
        return el;
    });
    return original;
}

describe('render, shared by every type', () => {
    it('resolves without doing anything when flow, tag or id is missing', async () => {
        await Script.handler({ id: 'qsl-t', src: '/a.js' }, {});
        await Script.handler({ flowId: 'default', src: '/a.js' }, {});
        expect(document.querySelectorAll('script').length).toBe(0);
    });

    it('awaits onBeforeStart, then waits `delay`, then inserts', async () => {
        const order = [];
        const done = Script.handler(base({
            src: '/a.js',
            delay: 30,
            onBeforeStart: async () => {
                await new Promise((r) => setTimeout(r, 10));
                order.push('before');
            },
            onComplete: () => order.push('complete'),
        }), {});

        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual(['before']);
        expect(document.querySelector('script')).toBeNull();

        await done;
        expect(order).toEqual(['before', 'complete']);
    });

    it('rejects and calls onError when onBeforeStart throws', async () => {
        const errors = [];
        const result = await Script.handler(base({
            src: '/a.js',
            onBeforeStart: () => { throw new Error('nope'); },
            onError: (e) => errors.push(e.message),
        }), {}).then(() => 'resolved', (e) => e.message);

        expect(result).toBe('nope');
        expect(errors).toEqual(['nope']);
    });

    it.each([
        [{ productId: 'sku-1' }, 'data-product-id', 'sku-1'],
        [{ target: '#reviews' }, 'data-target', '#reviews'],
        [{ count: 3 }, 'data-count', '3'],
        [{ 'weird key!': 'x' }, 'data-weirdkey', 'x'],
    ])('writes data %o as %s', async (data, attribute, value) => {
        await Script.handler(base({ src: '/a.js', data }), {});
        expect(document.querySelector('script').getAttribute(attribute)).toBe(value);
    });

    it.each([
        [false, 'head'],
        [true, 'body'],
    ])('footer: %s puts the element in <%s>', async (footer, where) => {
        await Script.handler(base({ src: '/a.js', footer }), {});
        expect(document[where].querySelector('script')).not.toBeNull();
    });

    it('hands the element to registerProcessElement', async () => {
        let registered = null;
        await Script.handler(base({ src: '/a.js' }), { registerProcessElement: (el) => { registered = el; } });
        expect(registered).toBe(document.querySelector('script'));
    });
});

describe('script type', () => {
    it('sets every attribute it supports', async () => {
        await Script.handler(base({
            src: '/a.js',
            module: true,
            async: true,
            defer: true,
            crossOrigin: 'anonymous',
            integrity: 'sha384-abc',
        }), {});

        const el = document.querySelector('script');
        expect(el.getAttribute('src')).toBe('/a.js');
        expect(el.type).toBe('module');
        expect(el.async).toBe(true);
        expect(el.defer).toBe(true);
        expect(el.crossOrigin).toBe('anonymous');
        expect(el.integrity).toBe('sha384-abc');
    });

    it.each([
        ['/a.js', /^\/a\.js\?\d+$/],
        ['/a.js?v=1', /^\/a\.js\?v=1&\d+$/],
    ])('bypassCache on %s', async (src, pattern) => {
        await Script.handler(base({ src, bypassCache: true }), {});
        expect(document.querySelector('script').getAttribute('src')).toMatch(pattern);
    });

    it('calls onComplete once loaded', async () => {
        let completed = 0;
        await Script.handler(base({ src: '/a.js', onComplete: () => completed++ }), {});
        expect(completed).toBe(1);
    });

    it('rejects and calls onError when the file fails to load', async () => {
        failNextAppend();
        const errors = [];
        const result = await Script.handler(base({ src: '/missing.js', onError: (e) => errors.push(e.type) }), {})
            .then(() => 'resolved', (e) => e.type);

        expect(result).toBe('error');
        expect(errors).toEqual(['error']);
    });
});

describe('stylesheet type', () => {
    it('inserts a stylesheet link and resolves once loaded', async () => {
        let completed = false;
        await Stylesheet.handler(base({ href: '/a.css', crossOrigin: 'anonymous', onComplete: () => { completed = true; } }), {});

        const el = document.querySelector('link');
        expect(el.rel).toBe('stylesheet');
        expect(el.getAttribute('href')).toBe('/a.css');
        expect(el.getAttribute('crossorigin')).toBe('anonymous');
        expect(completed).toBe(true);
    });

    it('bypassCache appends a timestamp', async () => {
        await Stylesheet.handler(base({ href: '/a.css', bypassCache: true }), {});
        expect(document.querySelector('link').getAttribute('href')).toMatch(/^\/a\.css\?\d+$/);
    });

    it('rejects when the file fails to load', async () => {
        failNextAppend();
        const result = await Stylesheet.handler(base({ href: '/missing.css' }), {}).then(() => 'resolved', () => 'rejected');
        expect(result).toBe('rejected');
    });
});

describe('style type', () => {
    it('inserts the code, without any <style> wrapper, and resolves at once', async () => {
        let completed = false;
        await InlineStyle.handler(base({ code: '<style>.a{color:red}</style>', onComplete: () => { completed = true; } }), {});

        const el = document.querySelector('style');
        expect(el.textContent).toBe('.a{color:red}');
        expect(completed).toBe(true);
    });
});

describe('pixel type', () => {
    function loadPixelWhenInserted() {
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                const img = document.querySelector('img');
                if (img) {
                    clearInterval(timer);
                    img.onload?.(new Event('load'));
                    resolve(img);
                }
            }, 1);
        });
    }

    it('inserts a hidden 1×1 image and resolves once it loads', async () => {
        let completed = false;
        const done = Pixel.handler(base({ src: '/p.gif', onComplete: () => { completed = true; } }), {});
        const img = await loadPixelWhenInserted();
        await done;

        expect(img.getAttribute('src')).toBe('/p.gif');
        expect(img.width).toBe(1);
        expect(img.height).toBe(1);
        expect(img.style.display).toBe('none');
        expect(completed).toBe(true);
    });

    it('applies a custom style instead of hiding', async () => {
        const done = Pixel.handler(base({ src: '/p.gif', style: { opacity: '0' } }), {});
        const img = await loadPixelWhenInserted();
        await done;

        expect(img.style.opacity).toBe('0');
        expect(img.style.display).toBe('');
    });

    it('with dom: false makes the request without inserting anything', async () => {
        let created = null;
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const el = createElement(tag);
            if (tag === 'img') created = el;
            return el;
        });

        const done = Pixel.handler(base({ src: '/p.gif', dom: false }), {});
        await waitFor(() => created && created.onload);
        created.onload(new Event('load'));
        await done;

        expect(created.getAttribute('src')).toBe('/p.gif');
        expect(document.querySelector('img')).toBeNull();
    });

    it('rejects when the image fails to load', async () => {
        failNextAppend();
        const result = await Pixel.handler(base({ src: '/missing.gif' }), {}).then(() => 'resolved', () => 'rejected');
        expect(result).toBe('rejected');
    });
});

describe('inline-script type', () => {
    it('runs classic code and resolves on the next microtask', async () => {
        let completed = false;
        await InlineScript.handler(base({ code: 'window.__inline = 1;', onComplete: () => { completed = true; } }), {});

        expect(document.querySelector('script').textContent).toBe('window.__inline = 1;');
        expect(completed).toBe(true);
    });

    it('resolves a module once its wrapper reports back', async () => {
        const done = InlineScript.handler(base({ code: 'void 0;', module: true }), {});
        const el = document.querySelector('script');
        expect(el.type).toBe('module');

        /**
         * happy-dom does not run module scripts; do what the wrapper does.
         */
        window.dispatchEvent(new Event('QSL:inline-script:completed:qsl-t'));
        await expect(done).resolves.toBeUndefined();
    });
});

describe('html type, fields', () => {
    it('sets id, a string className and style, in the footer', async () => {
        await HTML.handler(base({
            tag: 'section',
            html: 'x',
            className: 'promo',
            style: { color: 'red' },
            footer: true,
        }), {});

        const el = document.body.querySelector('section.promo');
        expect(el.id).toBe('qsl-t');
        expect(el.style.color).toBe('red');
    });
});

describe('shadow type, fields', () => {
    it('passes shadowData to the element, honours hidden and position: top', async () => {
        customElements.define('qs-test-fields', class extends HTMLElement {});
        document.body.innerHTML = '<div id="host"><p>existing</p></div>';

        await Shadow.handler(base({
            tag: 'qs-test-fields',
            shadowData: { container: '#host', position: 'top', hidden: true, greeting: 'hi' },
        }), {});

        const el = document.querySelector('#host').firstElementChild;
        expect(el.tagName.toLowerCase()).toBe('qs-test-fields');
        expect(el.hasAttribute('hidden')).toBe(true);
        expect(el.data.greeting).toBe('hi');
    });

    it('accepts body as the container', async () => {
        customElements.define('qs-test-body', class extends HTMLElement {});
        await Shadow.handler(base({ tag: 'qs-test-body', shadowData: { container: 'body' } }), {});
        expect(document.body.lastElementChild.tagName.toLowerCase()).toBe('qs-test-body');
    });
});

