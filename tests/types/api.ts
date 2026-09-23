/**
 * Type tests, run by `npm run test:types` (tsc, not vitest: nothing here
 * executes). Every line must compile; every `@ts-expect-error` must be an
 * error, or tsc reports the directive as unused.
 *
 * The import goes through the package name, so this also checks that
 * package.json points TypeScript at the declarations.
 */
import qsl, {
    core,
    Script,
    InlineScript,
    Pixel,
    conditions,
    triggers,
    logger,
    events,
    type QSL,
    type ProcessConfig,
    type Process,
    type FlowState,
    type Plugin,
    type TypeHandler,
} from '@quietsapa/qsl';
import '@quietsapa/qsl/browser';
import { expectTypeOf } from 'vitest';

expectTypeOf(qsl).toEqualTypeOf<QSL>();
expectTypeOf(core).toEqualTypeOf<QSL>();

/**
 * ── Setting up ──────────────────────────────────────────────────────────────
 */
qsl.registerTypes([Script, InlineScript, Pixel]).use(conditions).use(triggers).use(logger).use(events);
qsl.registerTypes({ custom: (process) => Promise.resolve(process.id) });
expectTypeOf(qsl.init()).resolves.toEqualTypeOf<QSL>();
expectTypeOf(qsl.load()).toEqualTypeOf<Promise<void>>();
qsl.load({ between: 100 });
qsl.strict = true;
qsl.timeout = 5000;
qsl.retries = 2;
qsl.retryDelay = 1000;
qsl.yield = false;
qsl.autoReset = false;
qsl.debug = true;

// @ts-expect-error the timeout is milliseconds, a number
qsl.timeout = '5s';
// @ts-expect-error read-only
qsl.VERSION = '9';

/**
 * ── Processes by type ───────────────────────────────────────────────────────
 */
qsl.add({ id: 'sdk', type: 'script', src: 'https://cdn.example/sdk.js', async: true, crossOrigin: 'anonymous', integrity: 'sha384-x', fetchPriority: 'low', module: true, bypassCache: true });
qsl.add({ type: 'script', src: '/a.js', timeout: 8000, retries: 2, retryDelay: 1000, strict: true, depends: ['sdk'], priority: 10, delay: 50, footer: true, data: { product: 'sku-1', count: 3, on: true } });
qsl.add({ type: 'inline-script', code: "acme.init('key');" }, 'setup');
qsl.add({ type: 'inline-script', code: "import x from './x.js';", module: true }, true);
qsl.add({ type: 'stylesheet', href: '/w.css', fetchPriority: 'high' });
qsl.add({ type: 'style', code: '.bar { color: red }' });
qsl.add({ type: 'pixel', src: '/p.gif?e=view', dom: false, style: { display: 'none' } });
qsl.add({ type: 'html', tag: 'div', html: 'Free delivery', className: ['promo', 'bar'], style: { color: 'red' }, footer: true });
qsl.add({ type: 'shadow', tag: 'acme-chat', shadowData: { container: 'body', position: 'top', greeting: 'Hi' } });
qsl.add({ message: 'no type: the console type' });
qsl.add({ type: 'console', message: 'explicit' });
qsl.add({
    type: 'script',
    src: '/a.js',
    onBeforeStart: async (process) => { expectTypeOf(process.id).toEqualTypeOf<string>(); },
    onComplete: () => {},
    onError: (error) => { expectTypeOf(error).toEqualTypeOf<unknown>(); },
});

// @ts-expect-error a script needs its src
qsl.add({ type: 'script' });
// @ts-expect-error `href` belongs to stylesheets
qsl.add({ type: 'script', src: '/a.js', href: '/a.css' });
// @ts-expect-error a typo in a field
qsl.add({ type: 'script', src: '/a.js', timout: 100 });
// @ts-expect-error not a fetch priority
qsl.add({ type: 'script', src: '/a.js', fetchPriority: 'urgent' });
// @ts-expect-error a type nobody registered
qsl.add({ type: 'carousel', slides: 3 });
// @ts-expect-error without a type, a process is the console type, which has no src
qsl.add({ src: '/a.js' });
// @ts-expect-error depends lists ids
qsl.add({ type: 'script', src: '/a.js', depends: 'sdk' });
// @ts-expect-error a flow id is a string, true or nothing
qsl.add({ type: 'script', src: '/a.js' }, 42);

/**
 * ── Triggers ────────────────────────────────────────────────────────────────
 */
for (const trigger of [
    true, 'interaction', 'load', 'idle', 'domready', 'delay:1200', 'hover:#chat', 'visible:#reviews', 'appears:.cart', 'media:(min-width: 900px)',
    ['domready', 'delay:1200'],
    { operator: 'or', triggers: ['hover:#chat', 'delay:20000'] },
    (release: () => void) => setTimeout(release, 10),
] as const) {
    qsl.add({ type: 'script', src: '/a.js', trigger });
}
qsl.setFlowOptions({ trigger: { operator: 'and', triggers: ['load', { operator: 'or', triggers: ['idle', 'delay:3000'] }] } }, 'f');

// @ts-expect-error a misspelt trigger
qsl.add({ type: 'script', src: '/a.js', trigger: 'visibel:#reviews' });
// @ts-expect-error the delay is a number of milliseconds
qsl.add({ type: 'script', src: '/a.js', trigger: 'delay:soon' });
// @ts-expect-error not an operator
qsl.add({ type: 'script', src: '/a.js', trigger: { operator: 'xor', triggers: ['load'] } });

/**
 * ── Conditions ──────────────────────────────────────────────────────────────
 */
for (const condition of [
    true, false, 'media:(prefers-reduced-motion: no-preference)',
    'lang:startsWith:ru', 'lang:in:en-US,en-CA', 'tz:contains:Europe', 'timezone:offset:3',
    'url:query:utm_source=ads', 'url:matches:#/home$', 'url:pathStartsWith:/blog',
    'ua:device:mobile', 'ua:os:ios', 'ua:browser:safari', 'userAgent:contains:Mobile',
    ['ua:device:mobile', 'ua:os:android'],
    { operator: 'or', conditions: ['lang:startsWith:ru', 'tz:is:Europe/Moscow'] },
    () => document.cookie.includes('returning=1'),
] as const) {
    qsl.add({ type: 'script', src: '/a.js', condition });
}

// @ts-expect-error not a device
qsl.add({ type: 'script', src: '/a.js', condition: 'ua:device:watch' });
// @ts-expect-error a URL condition needs its kind
qsl.add({ type: 'script', src: '/a.js', condition: 'url:utm_source' });
// @ts-expect-error `conditions`, not `triggers`
qsl.add({ type: 'script', src: '/a.js', condition: { operator: 'or', triggers: ['load'] } });

/**
 * ── Flows ───────────────────────────────────────────────────────────────────
 */
qsl.setFlowOptions({ ordered: true, strict: true, between: 120, depends: ['analytics'], timeout: 5000, retries: 1, retryDelay: 500 }, 'setup');
qsl.setFlowOptions({ group: 'marketing', paused: true, preload: true, priority: 5, delay: 100, fireEvents: false }, 'ads');
qsl.setFlowOptions({ beforeStart: () => {}, onComplete: () => {} });
qsl.setFlowOptions({ condition: 'url:query:debug' }, true);
qsl.runFlow('ads').pauseGroup('marketing').runGroup('marketing').reset();
expectTypeOf(qsl.inGroup('marketing')).toEqualTypeOf<string[]>();
expectTypeOf(qsl.processStates.get('qsl-sdk')).toEqualTypeOf<'completed' | 'failed' | 'skipped' | undefined>();
// @ts-expect-error gone in 0.5.0: processStates says how every process ended
qsl.completedProcesses;

const flow = qsl.flowOptions.get('setup');
if (flow) {
    expectTypeOf(flow).toEqualTypeOf<FlowState>();
    expectTypeOf(flow.status).toEqualTypeOf<'READY' | 'RUNNING' | 'COMPLETED'>();
    expectTypeOf(flow.outcome).toEqualTypeOf<'completed' | 'failed' | 'skipped' | undefined>();
}

// @ts-expect-error depends lists flow ids
qsl.setFlowOptions({ depends: 'analytics' }, 'setup');
// @ts-expect-error not a flow option
qsl.setFlowOptions({ prefetch: true }, 'setup');

/**
 * ── Events ──────────────────────────────────────────────────────────────────
 */
qsl.useEvents();
window.addEventListener('QSL:completed', (e) => {
    expectTypeOf(e.detail.id).toEqualTypeOf<string>();
    expectTypeOf(e.detail.flowId).toEqualTypeOf<string>();
});
window.addEventListener('QSL:error', (e) => { expectTypeOf(e.detail.error).toEqualTypeOf<unknown>(); });
window.addEventListener('QSL:skipped', (e) => {
    expectTypeOf(e.detail.reason).toEqualTypeOf<'condition' | 'dependency' | 'circular' | null>();
});
window.addEventListener('QSL:all:completed', () => {});

/**
 * ── The CDN build ───────────────────────────────────────────────────────────
 */
window.QSLReady = () => {
    const instance = window.__QSL__;
    expectTypeOf(instance).toEqualTypeOf<QSL | undefined>();
    instance?.add({ type: 'script', src: '/a.js' }).load();
};

/**
 * ── Logger, plugins, custom types ───────────────────────────────────────────
 */
qsl.setLogger({ log: (type, ...args) => console.log(type, ...args), error: (type, ...args) => console.error(type, ...args) });
qsl.setOnAllComplete(() => {});

// @ts-expect-error a logger needs both methods
qsl.setLogger({ log: () => {} });

const withOptions: Plugin<[{ debug: boolean }]> = (instance, options) => {
    if (options.debug) instance.setLogger(console as unknown as Parameters<QSL['setLogger']>[0]);
};
qsl.use(withOptions, { debug: true });
// @ts-expect-error the plugin wants its options
qsl.use(withOptions);

const handler: TypeHandler = (process, callbacks) => new Promise<void>((resolve, reject) => {
    expectTypeOf(process.id).toEqualTypeOf<string>();
    if (callbacks.retrying) return reject(new Error('retry'));
    resolve();
});
qsl.registerType('iframe', handler);

/**
 * A process as QSL hands it to hooks and handlers.
 */
qsl.processCompleteActions.add(function (process) {
    expectTypeOf(this).toEqualTypeOf<QSL>();
    expectTypeOf(process).toEqualTypeOf<Process>();
});
/**
 * The stream: one object per signal, the process when there is one.
 */
qsl.listeners.add(function (signal) {
    expectTypeOf(this).toEqualTypeOf<QSL>();
    expectTypeOf(signal.level).toEqualTypeOf<'info' | 'error'>();
    expectTypeOf(signal.time).toEqualTypeOf<number>();
    expectTypeOf(signal.process).toEqualTypeOf<Process | null>();
    expectTypeOf(signal.flow).toEqualTypeOf<string | null>();
    if (signal.type === 'PROCESS_FAILED') console.log(signal.args[0]);
});
qsl.emit('MY_PLUGIN_READY', 'info', null, 1, 2);
qsl.emit('MY_PLUGIN_BROKE', 'error', 'some-flow');
// @ts-expect-error: the level is 'info' or 'error'
qsl.emit('X', 'warn', null);

qsl.conditionHandlers.add((condition) => (condition === 'network:fast' ? !navigator.onLine : null));
qsl.triggerHandlers.add((trigger) => (trigger === 'scroll:60' ? (release) => release() : null));
qsl.allCompleteActions.add(function () { expectTypeOf(this).toEqualTypeOf<QSL>(); });
qsl.completedFlowsActions.add((done, flows, flowOptions) => {
    expectTypeOf(flows.get('f')).toEqualTypeOf<Process[] | undefined>();
    expectTypeOf(flowOptions.get('f')).toEqualTypeOf<FlowState | undefined>();
    return done;
});
qsl.maybeComplete();

const configs: ProcessConfig[] = [{ type: 'script', src: '/a.js' }, { type: 'pixel', src: '/p.gif' }];
configs.forEach((config) => qsl.add(config));
