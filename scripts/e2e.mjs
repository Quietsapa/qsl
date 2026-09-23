/**
 * Run every example in headless Chromium against the built bundle, and fail
 * if any of them does not behave as its page says it should.
 *
 * The unit tests run on src/ in happy-dom, which cannot execute module
 * scripts, load images or observe intersections, and never sees dist/. This
 * covers the gap: the real browser, the real bundle, the real pages.
 *
 * Each scenario drives the page, then waits until the expected state appears
 * — a slow machine makes the run slower, not red. The examples load QSL from
 * the CDN; the server rewrites that to the local dist/.
 *
 * Usage: npm run build && npm run test:e2e
 *
 * Chromium by default. E2E_BROWSER picks another engine:
 *
 *   E2E_BROWSER=firefox npm run test:e2e
 *   E2E_BROWSER=webkit npm run test:e2e     (Safari's engine)
 *
 * Each needs its Playwright build: `npx playwright install firefox webkit`.
 */

import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/@quietsapa\/qsl(?:@[^/]+)?\/dist\//g;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif' };

if (!existsSync(path.join(root, 'dist', 'qsl.min.js'))) {
    console.error('e2e: dist/qsl.min.js is missing — run `npm run build` first.');
    process.exit(1);
}

const server = createServer(async (req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) {
        res.writeHead(403);
        return res.end();
    }
    /**
     * ?delay=ms holds the response back, for the timing fixture.
     */
    const delay = Number(new URL(req.url, 'http://x').searchParams.get('delay')) || 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
        let body = await readFile(file);
        if (file.endsWith('.html')) body = body.toString().replace(CDN, '/dist/');
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
}).listen(0);

const base = `http://127.0.0.1:${server.address().port}/examples/`;
const engines = { chromium, firefox, webkit };
const engine = process.env.E2E_BROWSER || 'chromium';
if (!engines[engine]) {
    console.error(`e2e: unknown E2E_BROWSER "${engine}" — use chromium, firefox or webkit.`);
    process.exit(1);
}

/**
 * Which browser to drive. CI uses Playwright's own downloads
 * (`npx playwright install`). For Chromium, without one — on an older macOS,
 * say — the installed Google Chrome is used. Either can be forced:
 *
 *   E2E_CHANNEL=chrome npm run test:e2e
 *   CHROMIUM_PATH=/path/to/chrome npm run test:e2e
 */
async function launch() {
    if (engine !== 'chromium') {
        try {
            return await engines[engine].launch();
        } catch (e) {
            if (!String(e.message).includes("Executable doesn't exist")) throw e;
            console.error(`e2e: Playwright's ${engine} is not installed — run \`npx playwright install ${engine}\`.`);
            process.exit(1);
        }
    }
    if (process.env.E2E_CHANNEL || process.env.CHROMIUM_PATH) {
        return chromium.launch({
            channel: process.env.E2E_CHANNEL || undefined,
            executablePath: process.env.CHROMIUM_PATH || undefined,
        });
    }
    try {
        return await chromium.launch();
    } catch (e) {
        /**
         * No Playwright Chromium on this machine: fall back to Google Chrome.
         */
        if (!String(e.message).includes("Executable doesn't exist")) throw e;
        console.log('e2e: Playwright\'s Chromium is not installed, using Google Chrome instead.\n');
        return chromium.launch({ channel: 'chrome' });
    }
}

const browser = await launch();
console.log(`e2e: ${engine} ${browser.version()}\n`);
let failures = 0;

/**
 * Wait until `check`, evaluated in the page, returns true.
 */
async function until(page, check, arg, timeout = 8000) {
    await page.waitForFunction(check, arg, { timeout, polling: 50 });
}

async function scenario(name, pagePath, run, contextOptions = {}, usesQsl = true, expectedErrors = []) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    try {
        await page.goto(base + pagePath);
        if (usesQsl) await until(page, () => window.__QSL__ && window.__QSL__.initialized);
        await run(page);
        const unexpected = errors.filter((e) => !expectedErrors.some((re) => re.test(e)));
        if (unexpected.length) throw new Error('page errors: ' + unexpected.join('; '));
        console.log('PASS  ' + name);
    } catch (e) {
        failures++;
        console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]);
    } finally {
        await context.close();
    }
}

const rows = () => [...document.querySelectorAll('#rows tr')].map((r) => [...r.cells].map((c) => c.textContent));
const logLines = () => [...document.querySelectorAll('#log li')].map((l) => l.textContent.replace(/^\+\d+ms/, ''));

/**
 * The index page: every card leads to a page that exists
 */
await scenario('index: every example is linked and reachable', 'index.html', async (page) => {
    const links = await page.evaluate(() => [...document.querySelectorAll('ul.examples a')].map((a) => a.href));
    if (links.length !== 7) throw new Error(links.length + ' examples linked');
    for (const link of links) {
        const res = await page.request.get(link);
        if (!res.ok()) throw new Error(link + ' → ' + res.status());

        /**
         * And every example links back to this page.
         */
        await page.goto(link);
        const back = await page.evaluate(() => document.querySelector('a[href="../index.html"]')?.href);
        if (!back || !(await page.request.get(back)).ok()) throw new Error(link + ' has no working link back');
    }
}, {}, false);

/**
 * analytics-stack
 */
await scenario('analytics-stack: everything loads', 'analytics-stack/index.html', async (page) => {
    await until(page, () => {
        const r = [...document.querySelectorAll('#rows tr')].map((x) => [...x.cells].map((c) => c.textContent));
        return r.length === 8
            && r.filter((x) => x[2] === 'completed').length === 7
            && r.some((x) => x[0] === 'fallback-beacon' && x[2] === 'skipped' && x[3] === 'condition');
    });
});

await scenario('analytics-stack: the SDK is blocked', 'analytics-stack/index.html?blocked=1', async (page) => {
    await until(page, () => {
        const r = [...document.querySelectorAll('#rows tr')].map((x) => [...x.cells].map((c) => c.textContent));
        const get = (id) => r.find((x) => x[0] === id) || [];
        return get('sdk')[2] === 'error'
            && r.filter((x) => x[3] === 'dependency').length === 6
            && get('fallback-beacon')[2] === 'completed';
    });
    const uncaught = await page.evaluate(() => [...document.querySelectorAll('#log li')].filter((l) => l.textContent.includes('uncaught')).length);
    if (uncaught) throw new Error('a plugin ran without its SDK');
});

await scenario('analytics-stack: only the heatmap fails', 'analytics-stack/index.html?heatmap=broken', async (page) => {
    await until(page, () => {
        const r = [...document.querySelectorAll('#rows tr')].map((x) => [...x.cells].map((c) => c.textContent));
        const get = (id) => r.find((x) => x[0] === id) || [];
        return get('heatmap')[2] === 'error' && get('conversion-pixel')[2] === 'completed';
    });
});

/**
 * product-page
 */
await scenario('product-page: each widget at its moment', 'product-page/index.html', async (page) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.reload();
    await until(page, () => document.querySelectorAll('#board li.done').length >= 3);
    const first = await page.evaluate(() => [...document.querySelectorAll('#board li.done b')].map((b) => b.textContent).sort().join());
    if (first !== 'history,promo-bar,promo-style') throw new Error('first screen loaded ' + first);

    await page.evaluate(() => document.getElementById('reviews').scrollIntoView());
    await until(page, () => document.getElementById('b-reviews').className === 'done');

    await page.hover('#chat-launcher');
    await until(page, () => document.getElementById('b-chat').className === 'done');
    await page.click('#chat-launcher');
    await until(page, () => document.querySelector('acme-chat').shadowRoot.querySelector('.panel').hidden === false);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#add-to-cart');
    await until(page, () => document.getElementById('b-upsell').className === 'done');

    if (await page.evaluate(() => document.getElementById('b-zoom').className === 'done')) {
        throw new Error('zoom loaded on a narrow viewport');
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await until(page, () => document.querySelectorAll('#board li.done').length === 9);
});

/**
 * audience-targeting
 */
await scenario('audience-targeting: URL and flow conditions', 'audience-targeting/index.html?utm_source=newsletter&utm_campaign=spring-2026&debug=1', async (page) => {
    await until(page, () => document.querySelectorAll('#rows tr').length === 14);
    const r = await page.evaluate(rows);
    const ran = (id) => r.find((x) => x[0] === id)[1] === 'ran';
    if (!ran('newsletter-welcome') || !ran('spring-campaign') || ran('ads-landing-pixel')) throw new Error('URL conditions');
    if (r.filter((x) => x[2].includes('(flow)') && x[1] === 'ran').length !== 2) throw new Error('flow condition');
});

await scenario('audience-targeting: an iPhone in Canada', 'audience-targeting/index.html?utm_source=ads', async (page) => {
    await until(page, () => document.querySelectorAll('#rows tr').length === 14);
    const ran = await page.evaluate(() => [...document.querySelectorAll('#rows tr')]
        .filter((r) => r.cells[1].textContent === 'ran').map((r) => r.cells[0].textContent).sort().join());
    const expected = 'ads-landing-pixel,animated-hero,ios-app-banner,north-america-shipping,safari-date-polyfill';
    if (ran !== expected) throw new Error('ran: ' + ran);
}, {
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    viewport: { width: 390, height: 800 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

/**
 * spa-navigation
 */
await scenario('spa-navigation: runs per route', 'spa-navigation/index.html', async (page) => {
    const go = (hash) => page.evaluate((h) => { location.hash = h; }, hash);
    const count = (text) => page.evaluate((t) => [...document.querySelectorAll('#log li')].filter((l) => l.textContent.includes(t)).length, text);

    await until(page, () => [...document.querySelectorAll('#log li')].some((l) => l.textContent.includes('run #1 complete')));

    await go('#/product');
    await until(page, () => [...document.querySelectorAll('#log li')].some((l) => l.textContent.includes('run #2 complete')));

    /**
     * Home, then Product well within the 1.5 s popup: the product tags join
     * the home run, and the popup is skipped on its re-check.
     */
    await go('#/home');
    await page.waitForTimeout(300);
    await go('#/product');
    await until(page, () => [...document.querySelectorAll('#log li')].some((l) => l.textContent.includes('run #3 complete')));

    /**
     * Product, then Checkout before the card renders: reviews skipped.
     */
    await go('#/checkout');
    await until(page, () => [...document.querySelectorAll('#log li')].some((l) => l.textContent.includes('run #4 complete')));
    await go("#/evil');alert(1);//");
    await until(page, () => location.hash === '#/home');

    const log = await page.evaluate(logLines);
    if (await count('reviews.js') !== 2) throw new Error('reviews rendered ' + await count('reviews.js') + ' times');
    if (await count('fraud-check.js') !== 1) throw new Error('fraud check ran ' + await count('fraud-check.js') + ' times');
    if (await count('newsletter-popup — completed') !== 1) throw new Error('popup completed on the wrong route');
    if (!log.some((l) => l.includes('still in progress'))) throw new Error('no late add happened');
});

/**
 * consent-groups
 */
await scenario('consent-groups: withdraw holds the deferred flow', 'consent-groups/index.html', async (page) => {
    await page.click('#accept-all');
    await until(page, () => document.querySelectorAll('#log li').length >= 8);
    await page.click('#withdraw-buttons button:nth-child(2)');
    await page.click('.filler');
    await until(page, () => {
        const log = [...document.querySelectorAll('#log li')].map((l) => l.textContent);
        return log.some((l) => l.includes('session recording')) && log.some((l) => l.includes('chat widget'));
    });
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => [...document.querySelectorAll('#log li')].map((l) => l.textContent));
    if (log.some((l) => l.includes('remarketing'))) throw new Error('marketing ran after withdrawal');
});

await scenario('consent-groups: only analytics, released by scrolling', 'consent-groups/index.html', async (page) => {
    await page.click('#accept-selected');
    await page.mouse.move(300, 200);
    await page.mouse.wheel(0, 200);
    await until(page, () => [...document.querySelectorAll('#log li')].some((l) => l.textContent.includes('session recording')));
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => [...document.querySelectorAll('#log li')].map((l) => l.textContent));
    if (log.some((l) => l.includes('marketing'))) throw new Error('marketing ran without consent');
});

/**
 * legacy-domcontentloaded
 */
await scenario('legacy-domcontentloaded: three work, the control does not', 'legacy-domcontentloaded/index.html', async (page) => {
    await until(page, () => [...document.querySelectorAll('.state')].map((s) => s.className).join() === 'state ok,state ok,state ok,state bad');
});

/**
 * extending
 */
await scenario('extending: types, plugin, logger, timings', 'extending/index.html', async (page) => {
    await page.click('#show-map');
    await until(page, () => document.querySelector('#map iframe'));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await until(page, () => document.getElementById('comments').textContent.includes('AcmeComments'));
    await until(page, () => !document.getElementById('reset').disabled);

    const result = await page.evaluate(() => ({
        flows: [...document.querySelectorAll('#flows tr')].map((r) => r.textContent).join('|'),
        timings: [...document.querySelectorAll('#timings tr')].map((r) => r.cells[0].textContent + ':' + r.cells[1].textContent),
        logger: document.getElementById('logger').textContent,
    }));
    const t = result.timings;
    if (!result.flows.includes('misconfiguredCOMPLETEDfailed')) throw new Error('flow outcome: ' + result.flows);
    for (const expected of ['widget-a:skipped: circular', 'typo:completed', 'no-such-type:error', 'map:completed', 'comments-ready:completed']) {
        if (!t.includes(expected)) throw new Error('missing ' + expected);
    }
    if (t.indexOf('consent-defaults:completed') > t.indexOf('tag-manager:completed')) throw new Error('priority ignored');
    if (!result.logger.includes('DEP_NOT_FOUND')) throw new Error('logger');
});

/**
 * Modules, from a fixture rather than an example (happy-dom runs no modules):
 * a module is a plain <script type="module">, and a process ends the way the
 * browser reports it.
 */
await scenario('modules: plain module scripts, as the browser runs them', '../scripts/fixtures/modules/index.html', async (page) => {
    await until(page, () => window.done === true);
    await until(page, () => window.awaited === 1 && window.externalAwaited === 1);
    const r = await page.evaluate(() => ({
        outcomes: window.outcomes,
        atDone: window.atDone,
        values: [window.relative, window.nested, window.parent_, window.root],
        modules: document.querySelectorAll('script[type="module"]').length,
    }));
    for (const id of ['relative', 'nested', 'parent', 'root', 'await', 'external', 'external-throws']) {
        if (r.outcomes[id] !== 'completed') throw new Error(`${id}: ${r.outcomes[id]}`);
    }
    if (JSON.stringify(r.values) !== '["dep","c","shared","shared"]') throw new Error('values ' + JSON.stringify(r.values));
    /**
     * QSL does not wait for an inline module, in any browser. When a module
     * script's load event fires relative to its top-level await is up to the
     * browser; it is reported, not asserted.
     */
    if (r.atDone.awaited) throw new Error('waited for an inline module');
    console.log(`      (${engine}: a module script's load came ${r.atDone.externalAwaited ? 'after' : 'before'} its top-level await finished)`);
    if (r.modules !== 7) throw new Error('module scripts: ' + r.modules);
}, {}, true, [/in dependency/]);

/**
 * Timing in a real browser, over a real (local, held back) network: flows run
 * side by side, each process starts as soon as what it waits for is done, an
 * ordered flow runs back to back. The bounds leave room for a slow machine;
 * what they rule out is serial loading and waits nobody asked for.
 */
await scenario('timing: side by side, and each as soon as it may', '../scripts/fixtures/timing/index.html', async (page) => {
    await until(page, () => typeof window.end === 'number');
    const { times: t, end } = await page.evaluate(() => ({ times: window.times, end: window.end }));
    const round = (n) => Math.round(n);
    for (const id of ['p1', 'p2', 'p3', 'p4', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3']) {
        if (t[id]?.outcome !== 'PROCESS_COMPLETED') throw new Error(`${id}: ${t[id]?.outcome}`);
    }
    const parallel = ['p1', 'p2', 'p3', 'p4'];
    const lastStart = Math.max(...parallel.map((id) => t[id].started));
    const lastEnd = Math.max(...parallel.map((id) => t[id].settled));
    if (lastStart > 100) throw new Error(`parallel flows started as late as ${round(lastStart)} ms`);
    if (lastEnd > 700) throw new Error(`four 300 ms flows took ${round(lastEnd)} ms: not side by side`);
    const gaps = [
        ['c2 after c1', t.c2.started - t.c1.settled],
        ['c3 after c2', t.c3.started - t.c2.settled],
        ['o2 after o1', t.o2.started - t.o1.settled],
        ['o3 after o2', t.o3.started - t.o2.settled],
    ];
    for (const [what, gap] of gaps) {
        if (gap < 0) throw new Error(`${what}: started ${round(-gap)} ms before it settled`);
        if (gap > 50) throw new Error(`${what}: ${round(gap)} ms idle`);
    }
    if (t.c3.settled < 600 || t.o3.settled < 450) throw new Error('a chain finished sooner than its parts can');
    if (end - Math.max(...Object.values(t).map((x) => x.settled)) > 50) throw new Error(`load() resolved ${round(end)} ms, late`);
    console.log(`      (${engine}: four 300 ms flows in ${round(lastEnd)} ms, idle between links at most ${Math.max(...gaps.map(([, g]) => round(g)))} ms, run ${round(end)} ms)`);
});

/**
 * Trusted Types, from fixtures: a page that enforces them and allows QSL's
 * policy, and one that allows none. Only engines with Trusted Types enforce
 * the second; elsewhere both behave like any page.
 */
await scenario('trusted-types: every type works with the qsl policy allowed', '../scripts/fixtures/trusted-types/allowed.html', async (page) => {
    await until(page, () => window.done === true);
    const r = await page.evaluate(() => ({
        outcomes: window.outcomes,
        ran: [window.externalRan, window.inlineRan, !!document.getElementById('from-html')],
        enforced: typeof window.trustedTypes !== 'undefined',
    }));
    for (const id of ['script', 'inline', 'html', 'stylesheet', 'style', 'pixel']) {
        if (r.outcomes[id] !== 'completed') throw new Error(`${id}: ${r.outcomes[id]}`);
    }
    if (r.ran.join() !== 'true,true,true') throw new Error('ran: ' + r.ran.join());
    console.log(`      (${engine}: Trusted Types ${r.enforced ? 'enforced' : 'not supported'})`);
});

await scenario('trusted-types: without the policy, the script and markup types fail rather than hang', '../scripts/fixtures/trusted-types/denied.html', async (page) => {
    await until(page, () => window.done === true);
    const r = await page.evaluate(() => ({ outcomes: window.outcomes, enforced: typeof window.trustedTypes !== 'undefined' }));
    const blocked = r.enforced ? 'error' : 'completed';
    for (const id of ['script', 'inline', 'html']) {
        if (r.outcomes[id] !== blocked) throw new Error(`${id}: ${r.outcomes[id]}, expected ${blocked}`);
    }
    for (const id of ['stylesheet', 'style', 'pixel']) {
        if (r.outcomes[id] !== 'completed') throw new Error(`${id}: ${r.outcomes[id]}`);
    }
}, {}, true, [/TrustedScript|TrustedHTML|TrustedScriptURL|Trusted Type/i]);

await browser.close();
server.close();

console.log(failures ? `\n${failures} scenario(s) failed in ${engine}` : `\nAll scenarios passed in ${engine}`);
process.exit(failures ? 1 : 0);
