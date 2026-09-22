# QSL

[![CI](https://github.com/Quietsapa/qsl/actions/workflows/ci.yml/badge.svg)](https://github.com/Quietsapa/qsl/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@quietsapa/qsl.svg)](https://www.npmjs.com/package/@quietsapa/qsl)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**A modern orchestrator for the third-party code that has to live in the browser.**

A dependency-aware orchestration runtime for everything a page loads besides its
own code: analytics tags, chat widgets, A/B testing snippets, tracking pixels,
stylesheets and custom elements.

Instead of scattering `<script>` tags through a template and hoping the order
works out, you describe what should load, when it should load, and what it
depends on. QSL resolves the graph and runs it.

```js
core
    .add({ id: 'analytics', type: 'script', src: '/a.js' }, 'metrics')
    .add({ id: 'heatmap', type: 'script', src: '/h.js', depends: ['analytics'], trigger: 'idle' }, 'metrics')
    .add({ id: 'chat', type: 'script', src: '/c.js', trigger: 'visible:#footer' }, 'widgets');

core.setFlowOptions({ ordered: true }, 'metrics');

await core.load();
```

It is deliberately small, has no runtime dependencies, and does not talk to any
server. Configuration comes from wherever you want: a static object, your CMS,
or an API.

## Status

Pre-1.0. The API described here is what ships today, but it may still change
between minor versions. Pin an exact version if that matters to you.

## Installation

```sh
npm install @quietsapa/qsl
```

Or load a prebuilt bundle straight from a CDN:

```html
<!-- everything: all types, conditions, triggers, logging -->
<script src="https://cdn.jsdelivr.net/npm/@quietsapa/qsl/dist/qsl.min.js"></script>

<!-- just scripts: files and inline snippets, in order -->
<script src="https://cdn.jsdelivr.net/npm/@quietsapa/qsl/dist/qsl.slim.min.js"></script>
```

Both browser bundles register their types and call `init()` for you, then
expose the instance as `window.__QSL__`.

### Loading QSL without blocking the parser

The tag above is a blocking one: the parser stops until QSL has downloaded.
That is the simplest thing that works, and for a small file served from a CDN
it is often fine.

To take it off the critical path, mark the tag `async` and add `?async=true` to
the URL. QSL then calls `window.QSLReady()` once it has finished initialising,
and you do your work there:

```html
<script>
  window.QSLReady = function () {
    var qsl = window.__QSL__;
    qsl.add({ id: 'gtm', type: 'script', src: 'https://example.com/gtm.js' });
    qsl.load();
  };
</script>
<script async src="https://cdn.jsdelivr.net/npm/@quietsapa/qsl/dist/qsl.min.js?async=true"></script>
```

The callback exists because `async` removes any guarantee about ordering. An
inline script placed after the tag runs while QSL is still downloading, so
`window.__QSL__` is not there yet and reading it gives you `undefined`. The
callback fires when the instance is actually ready.

Three things to keep in mind:

- **Define the callback before the tag.** QSL calls it once, immediately after
  `init()`. If the global is not a function at that moment nothing happens —
  no error, no retry.
- **`?async=true` is required.** Without it QSL initialises normally and never
  looks for a callback. The `async` attribute alone changes when the script
  runs, not what it does.
- **Rename it if `QSLReady` collides**, with `?callback=myHandler`. The name is
  read from the same query string.

The DOM is only guaranteed to be parsed up to the tag itself, so keep it at the
end of `<body>` if your setup code touches elements. Triggers like `domready`
and `load` handle the rest for you and fire correctly even when QSL arrives
after those events have passed.

| Build | Entry | Size (gzip) | Contents |
| --- | --- | --- | --- |
| `dist/qsl.mjs` | `src/index.js` | — | ESM, nothing registered, nothing started |
| `dist/qsl.min.js` | `src/presets/full.js` | ~9.3 kB | All types, conditions, triggers, and the logger and events plugins |
| `dist/qsl.slim.min.js` | `src/presets/default.js` | ~6.0 kB | The `script` and `inline-script` types only |

## Quick start

The ESM entry is side-effect free: importing it registers nothing. You compose
what you need and call `init()` yourself.

```js
import core, { Script, Stylesheet, triggers, conditions } from '@quietsapa/qsl';

await core
    .registerTypes([Script, Stylesheet])
    .use(triggers)
    .use(conditions)
    .init();

core.add({ id: 'gtm', type: 'script', src: 'https://example.com/gtm.js' });
core.add({ id: 'widget', type: 'script', src: '/widget.js', trigger: 'interaction' });

await core.load();
```

With a CDN bundle the registration is already done:

```html
<script src="https://cdn.jsdelivr.net/npm/@quietsapa/qsl/dist/qsl.min.js"></script>
<script>
  var qsl = window.__QSL__;
  qsl.add({ id: 'gtm', type: 'script', src: 'https://example.com/gtm.js' });
  qsl.load();
</script>
```

## Concepts

**Process** — one thing to load: a script, a stylesheet, a pixel, an element.
Described by a plain object whose `type` selects the handler.

**Flow** — a named group of processes. Flows run in parallel with each other.
Inside a flow, processes run in parallel too, unless the flow is `ordered`, in
which case each one waits for the previous to finish.

Two flow names are special: `default` is where processes go when you pass no
flow, and `ordered` is a ready-made sequential flow. `core.add(config, true)`
is shorthand for the latter.

**Trigger** — when a flow or process is allowed to start. Until the trigger
fires, it waits.

**Condition** — whether it should run at all. A failing condition skips it.
A process checks its condition when it starts and again right before it runs,
after its trigger and dependencies, so a long wait cannot run it in a context
that no longer applies.

**Dependency** — `depends` makes a process or flow wait for others to finish.
Circular dependencies are broken rather than deadlocking: every member of a
cycle is skipped with reason `'circular'`, and whatever depends on the cycle
settles by the usual rules. A dependency that does not exist is logged and
ignored.

**Late adds** — a flow created while a run is in progress, by `add()` or by
`setFlowOptions()`, is a late flow: it starts once the regular flows are done,
follows its own options like any flow, and the run completes when it does. A
process added with no flow gets a late flow of its own. A process added to a
flow that has already started gets one too, carrying over that flow's
`condition`, `strict`, `fireEvents` and `group`: a started flow runs from the
list it had when it started.

**Outcome** — every process settles exactly once: completed, failed or
skipped. All three release whatever depends on it. By default a dependent then
runs regardless; set `strict: true` and it is skipped instead when a
dependency failed or was skipped, and so on down the chain. `strict` can be set
on a process, on a flow, or for the whole instance, and the nearest setting
wins. For a flow, `strict` means: skip if a flow it depends on was skipped or
had a failure inside it.

`ordered` and `strict` are separate: `ordered` decides when a process starts,
`strict` whether it runs at all. In a strict ordered flow each process counts
as depending on the one before it, so after a failure (a timeout included) the
rest of the chain is skipped with `reason: 'dependency'` instead of running
without it. A process skipped by its own `condition` does not break the chain;
it is a deliberate step. `strict: false` on one process lets it run after a
failure, and the chain carries on from there.

```js
core.setFlowOptions({ ordered: true, strict: true }, 'setup');
```

**Timeout** — `timeout` is how many milliseconds a process may take once it
starts loading; waiting for its trigger or its dependencies does not count.
When it runs out, the process fails with a `TimeoutError`, exactly like a load
error: `onError` is called, `QSL:error` fires and `strict` dependents skip.
Like `strict` it can be set on a process, on a flow or for the whole instance,
and `0` turns it off. A request cannot be cancelled: a script that arrives
after its deadline still runs, but QSL has already moved on without it.

**Retries** — `retries` is how many more times a load that failed is
attempted before the process fails, `0` by default. `onError` and `QSL:error`
come once, for the final outcome; each retry is logged as `PROCESS_RETRY`, and
the failed element is removed before the next attempt. With a `timeout` the
time limit covers all attempts together, and an attempt that timed out is
never retried: its resource may still arrive and run, and a second copy would
run twice. Set it on a process, a flow or the instance, like `timeout`.

`retryDelay` is how many milliseconds to wait before each retry, `0` by
default: a server that just answered 503 rarely recovers in the same
millisecond. The wait counts against the `timeout` like the attempts do, and
no attempt starts once it has run out.

```js
core.add({ id: 'sdk', type: 'script', src: 'https://cdn.example/sdk.js', retries: 2, retryDelay: 1000, timeout: 8000 });
```

## API

### `init()`

Registers internal listeners and runs `initActions` from plugins. Returns a
promise resolving to the instance. Safe to call more than once.

If the script element that loaded QSL has `?async=true` in its URL, `init()`
also calls `window.QSLReady()` when it finishes, or a different global named by
the `callback` query parameter.

### `add(config, flowId = null)`

Adds a process. `flowId` may be a string, `true` (the `ordered` flow), or
omitted (the `default` flow). Returns the instance.

`config.id` is optional; a random one is generated. Note that ids are stored
with a `qsl-` prefix internally, but `depends` is written with the unprefixed id
you passed.

### `load(options = {})`

Starts everything. Returns a promise that resolves once every flow has
completed. `options.between` sets a default delay in milliseconds between
consecutive processes.

Calling `load()` a second time while a run is in progress does nothing.

### `setFlowOptions(options, flowId = null)`

Sets options on a flow, creating it if needed. Merges with previous options.

| Option | Default | Meaning |
| --- | --- | --- |
| `ordered` | `false` | Run processes sequentially |
| `delay` | `0` | Milliseconds to wait before the flow starts |
| `between` | `null` | Milliseconds between consecutive processes |
| `priority` | `0` | Higher runs earlier; flows with a trigger always go last |
| `trigger` | `null` | See [Triggers](#triggers) |
| `condition` | `null` | See [Conditions](#conditions) |
| `depends` | `[]` | Flow ids to wait for |
| `group` | `null` | Group name for `pauseGroup` / `runGroup` |
| `paused` | `false` | Hold the flow until `runFlow()` or `runGroup()` |
| `strict` | — | Skip when a dependency failed or was skipped. Not set: inherits `qsl.strict` |
| `timeout` | — | Default `timeout` for the flow's processes, in ms. Not set: inherits `qsl.timeout` |
| `retries` | — | Default `retries` for the flow's processes. Not set: inherits `qsl.retries` |
| `retryDelay` | — | Default `retryDelay` for the flow's processes, in ms. Not set: inherits `qsl.retryDelay` |
| `preload` | `false` | Emit `<link rel=preload>` for scripts and styles |
| `fireEvents` | `true` | Let the `events` plugin re-dispatch lifecycle events |

### Other methods

- `use(plugin, ...args)` — run a plugin function against the instance.
- `registerType(type, handler)` / `registerTypes(list)` — add resource types.
  `registerTypes` accepts `[{ type, handler }]` or `{ type: handler }`.
- `runFlow(flowId, withTrigger = false)` — start a paused flow.
- `pauseGroup(name)` / `runGroup(name)` — act on every flow in a group.
  `pauseGroup` pauses anything in the group that has not started yet,
  including a flow already waiting for its trigger or its dependencies;
  `runGroup` releases it, and a flow whose trigger fired during the pause
  waits for that trigger afresh. A flow belongs to the group its `group`
  option names at that moment; `inGroup(name)` lists them.
- `processStates` — a `Map` of how each settled process ended, by prefixed id:
  `'completed'`, `'failed'` or `'skipped'`. Cleared by `reset()`.
- `setLogger(logger)` — supply an object with `log()` and `error()`.
- `setOnAllComplete(fn)` — callback for the end of a run.
- `useEvents()` — enable DOM lifecycle events.
- `reset()` — clear run state. Registered types and plugin handlers survive, so
  a later `add()` and `load()` behave the same as the first run.
- `destroy()` — clear everything, including types and plugins. `init()` must be
  called again afterwards.
- `autoReset` — set to `false` to keep flow state after a run, for debugging.
- `strict` — instance default for `strict` (see Outcome above). `false` unless
  you set it.
- `timeout` — instance default for `timeout` (see Timeout above). No limit
  unless you set it.
- `retries` — instance default for `retries` (see Retries above). `0` unless
  you set it.
- `retryDelay` — instance default for `retryDelay`, in ms. `0` unless you set
  it.
- `debug` — `false` by default. With the `logger` plugin (in the full bundle),
  `true` also prints QSL's own progress: every process started, completed or
  skipped, retries, late adds. Errors, and misconfiguration such as an unknown
  type or a dependency that does not exist, are printed either way.
- `yield` — `true` by default: before each process runs, QSL gives the main
  thread back with `scheduler.yield()`, where the browser has it. Processes
  released together (a flow starting, a dependency settling, the next step of
  an ordered chain) then run as separate tasks, not one long one, and a click
  in between is handled at once instead of waiting for all of them. It matters
  for synchronous work: inline scripts, `html` and `shadow` with a lot of
  markup, heavy `onComplete`; external scripts already run as tasks of their
  own. In a browser without `scheduler.yield()` (Safari, for now) nothing
  changes. Set `false` if some inline code relies on running in the same task
  as the one before it.

## Types

Every type is a `{ type, handler }` pair. Handlers receive the process config
and return a promise: resolve when the resource is ready, reject when it
failed. A rejection settles the process as failed. Calling `onComplete` and
`onError` is the handler's job, as the built-in types do.

| Type | Key fields |
| --- | --- |
| `script` | `src`, `module`, `async`, `defer`, `crossOrigin`, `integrity`, `fetchPriority`, `bypassCache` |
| `inline-script` | `code`, `module` |
| `stylesheet` | `href`, `crossOrigin`, `fetchPriority`, `bypassCache` |
| `style` | `code` |
| `pixel` | `src`, `dom`, `style`, `fetchPriority`, `bypassCache` |
| `html` | `tag`, `html`, `id`, `className`, `style` |
| `shadow` | `tag`, `shadowData: { container, position, hidden }` |
| `console` | `message` — built in, used as the default type |

**Modules.** `module: true` makes a `<script type="module">`, and the browser
runs it as it runs any module; QSL adds nothing. For `script` the process
completes on the browser's `load` event, which a module fires even if it
throws, and in Chromium before a top-level `await` is done. An
`inline-script` module completes as soon as it is inserted: the browser runs
it later and reports nothing when it has. When something has to wait for a
module to finish, have the module say so — dispatch an event, or set a global
that a `wait-for-global` style type watches (see the extending example).

`fetchPriority` (`'high'`, `'low'` or `'auto'`) becomes the `fetchpriority`
attribute, a hint to the browser about which requests matter more. `'low'`
suits most third-party code: it keeps a widget from competing with the page's
own images and scripts. A flow with `preload` passes it on to the
`<link rel=preload>` as well.

Common fields across types: `id`, `type`, `depends`, `condition`, `trigger`,
`priority`, `delay`, `strict`, `timeout`, `retries`, `retryDelay`, `data` (rendered as `data-*`
attributes), `footer` (append to `<body>` instead of `<head>`), `fireEvents`
(`false` keeps the events plugin away from this process), and the callbacks
`onBeforeStart`, `onComplete`, `onError`.

Writing your own is a function returning a promise:

```js
core.registerType('json', (process) =>
    fetch(process.url)
        .then((r) => r.json())
        .then(process.onComplete)
);
```

The handler's second argument holds extra callbacks from plugins. During an
attempt that will be retried if it fails, it also carries `retrying: true`, and
`onError` is left out of the process: clean up what the attempt added, and
leave reporting to the last one. A type needs no timer of its own: give the
process a `timeout`, and QSL fails it when the time is up.

## Triggers

Set `trigger` on a process or a flow.

| Trigger | Fires when |
| --- | --- |
| `'load'` | The window `load` event |
| `'domready'` | `DOMContentLoaded`, or immediately if it already happened |
| `'idle'` | `requestIdleCallback`, falling back to a 200 ms timeout |
| `'interaction'` or `true` | First click, keydown, wheel, mousedown, mousemove or touchstart |
| `'delay:2000'` | After the given number of milliseconds |
| `'hover:<selector>'` | Pointer moves over the element |
| `'visible:<selector>'` | Element intersects the viewport (`IntersectionObserver`) |
| `'appears:<selector>'` | Element is inserted into the DOM (`MutationObserver`) |
| `'media:<query>'` | Media query matches, now or later |
| a function | You call the callback it receives |

Selectors and queries may contain colons; they are parsed by prefix length, not
by splitting.

Combine them with an array (all must fire) or an operator object:

```js
{ trigger: ['domready', 'delay:1000'] }
{ trigger: { operator: 'or', triggers: ['idle', 'interaction'] } }
```

## Conditions

Set `condition` on a process or a flow. A failing condition skips it.

| Condition | Example |
| --- | --- |
| `media:<query>` | `media:(min-width: 768px)` |
| `lang:<op>:<value>` | `lang:startsWith:ru`, `lang:in:en-US,en-GB` |
| `tz:<op>:<value>` | `tz:contains:Europe`, `tz:offset:3` |
| `url:<op>:<value>` | `url:pathStartsWith:/blog`, `url:query:utm_source=ads` |
| `ua:<op>:<value>` | `ua:device:mobile`, `ua:browser:safari`, `ua:os:ios` |
| a function | Return `true` to run, `false` to skip |
| a boolean | `false` skips |

Operators: `equals`/`is`, `contains`, `startsWith`, `in` for language;
`equals`/`is`, `contains`, `offset` for timezone; `contains`, `path`,
`pathStartsWith`, `pathEndsWith`, `query`, `hostname`, `matches`, `pathMatches`
for URL; `contains`, `equals`/`is`, `matches`, `browser`, `device`,
`os`/`platform` for user agent.

Combine with an array (all must pass) or an operator object:

```js
{ condition: ['ua:device:desktop', 'url:pathStartsWith:/app'] }
{ condition: { operator: 'or', conditions: ['lang:is:ru-RU', 'tz:contains:Europe'] } }
```

An unparseable regular expression fails the condition rather than throwing.

## Plugins

A plugin is a function that receives the instance and registers handlers on it.

| Plugin | What it adds |
| --- | --- |
| `conditions` | The five condition handlers above |
| `triggers` | The nine trigger handlers above |
| `logger` | A console logger with readable message names. Errors always; QSL's own progress only with `qsl.debug = true` |
| `events` | Re-dispatches `DOMContentLoaded` and `load` per process, so late-loaded third-party scripts that listen for them still initialise |

Every plugin above is already registered in the full
browser bundle. The slim bundle registers none of them. With the ESM entry you
register what you want yourself:

```js
import core, { triggers, conditions, logger } from '@quietsapa/qsl';

core.use(triggers).use(conditions).use(logger);
```

## Events

Call `useEvents()` to enable them. Each carries the process config as `detail`.

`QSL:started`, `QSL:completed`, `QSL:error`, `QSL:skipped`,
`QSL:all:completed`.

Exactly one of `completed`, `error` or `skipped` fires per process. On
`QSL:error`, `detail.error` holds what the handler rejected with — the
element's `error` event for the built-in types, or an `Error` named
`TimeoutError` when the process ran out of time. On `QSL:skipped`,
`detail.reason` says why: `'condition'`, `'dependency'` (a `strict` process or
flow whose dependency failed or was skipped) or `'circular'`.

## TypeScript

Type declarations ship with the package; there is nothing to install. The
runtime stays plain JavaScript, and the declarations are checked against it in
CI.

`add()` takes a union keyed by `type`, so each type's fields are checked:
a `script` needs its `src`, `href` belongs to stylesheets, and a misspelt
field is an error. Triggers and conditions are checked by form —
`'visible:#reviews'` and `'ua:device:mobile'` pass, `'visibel:#reviews'` and
`'ua:device:watch'` do not. The `QSL:*` events are typed on `window`, and so is
`window.__QSL__` for pages that load the browser bundle.

A custom type, trigger or condition makes itself known by extending an
interface:

```ts
import qsl from '@quietsapa/qsl';

declare module '@quietsapa/qsl' {
    interface CustomTypes {
        iframe: { srcdoc: string; container: string };
    }
    interface CustomTriggers {
        [form: `scroll:${number}`]: true;
    }
    interface CustomConditions {
        'network:fast': true;
    }
}

qsl.add({ type: 'iframe', srcdoc: '<p>Map</p>', container: '#map', trigger: 'scroll:60', condition: 'network:fast' });
```

The declarations work with TypeScript 5.x and later, and are tested with 6.0
and 7.0.

## Examples

Runnable pages in [`examples/`](examples/), also live at
**[quietsapa.github.io/qsl](https://quietsapa.github.io/qsl/)**. To run them
locally, open any `index.html` in a browser; no build step or server needed.

| Example | Shows |
| --- | --- |
| [analytics-stack](examples/analytics-stack/) | An SDK, its plugins, ordered setup calls and marketing that needs them; `strict` when the SDK is blocked, with a fallback beacon |
| [product-page](examples/product-page/) | Each widget loaded at its own moment: visible, hover or timeout, media query, element appears, idle |
| [audience-targeting](examples/audience-targeting/) | Every condition type, combined with arrays, `or` and `and`, on processes and on a flow |
| [spa-navigation](examples/spa-navigation/) | A run per route change, conditions re-checked after a wait, late adds deferred to the running run |
| [consent-groups](examples/consent-groups/) | Consent categories as groups, an immediate and a deferred flow in each, and withdrawing consent |
| [legacy-domcontentloaded](examples/legacy-domcontentloaded/) | Late-loaded vendor scripts that listen for `DOMContentLoaded` or `load`, with and without QSL |
| [extending](examples/extending/) | Custom types, a plugin with its own trigger and condition, a logger, timings, `runFlow`, `priority`, `autoReset` |

## Security

**QSL treats its configuration as trusted, privileged input.** The
`inline-script` type executes code, the `html` type writes to `innerHTML`, and
several conditions compile regular expressions from strings. Never build a
configuration from untrusted input.

On a page that enforces Trusted Types, allow QSL's policy by name:
`trusted-types qsl` in the Content Security Policy. It passes values through
unchanged, since the configuration is trusted.

Read [SECURITY.md](SECURITY.md) before deploying. It covers the trust model,
Content Security Policy and Trusted Types, and how to report a vulnerability.

## Development

```sh
npm install
npm test                # vitest + happy-dom
npm run test:coverage   # the same, with the coverage floors CI enforces
npm run test:scheduler  # the same suite with scheduler.yield() present
npm run test:types      # the type declarations, with tsc
npm run build           # three bundles into dist/
npm run check:size      # gzip budgets for the browser bundles
npm run test:e2e        # every example in headless Chromium, against dist/
E2E_BROWSER=firefox npm run test:e2e   # or webkit, Safari's engine
```

`npm run check:version` guards against `VERSION` in `src/core.js` drifting away
from `package.json`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports with a reproduction are the
most useful thing you can send.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
