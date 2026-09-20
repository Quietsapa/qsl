# QSL

[![CI](https://github.com/Quietsapa/qsl/actions/workflows/ci.yml/badge.svg)](https://github.com/Quietsapa/qsl/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@quietsapa/qsl.svg)](https://www.npmjs.com/package/@quietsapa/qsl)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

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

<!-- just ordered script loading -->
<script src="https://cdn.jsdelivr.net/npm/@quietsapa/qsl/dist/qsl.slim.min.js"></script>
```

Both browser bundles register their types and call `init()` for you, then
expose the instance as `window.__QSL__`.

| Build | Entry | Size (gzip) | Contents |
| --- | --- | --- | --- |
| `dist/qsl.mjs` | `src/index.js` | — | ESM, nothing registered, nothing started |
| `dist/qsl.min.js` | `src/presets/full.js` | ~8.3 kB | All types, conditions, triggers, logger, events |
| `dist/qsl.slim.min.js` | `src/presets/default.js` | ~4.4 kB | The `script` type only |

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

**Dependency** — `depends` makes a process or flow wait for others to finish.
Circular dependencies are detected by the `circ` plugin and broken rather than
deadlocking; a dependency that does not exist is logged and ignored.

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
| `depends` | `[]` | Flow ids to wait for. Setting this pauses the flow |
| `group` | `null` | Group name for `pauseGroup` / `runGroup` |
| `paused` | `false` | Hold the flow until `runFlow()` |
| `preload` | `false` | Emit `<link rel=preload>` for scripts and styles |
| `fireEvents` | `true` | Let the `events` plugin re-dispatch lifecycle events |

### Other methods

- `use(plugin, ...args)` — run a plugin function against the instance.
- `registerType(type, handler)` / `registerTypes(list)` — add resource types.
  `registerTypes` accepts `[{ type, handler }]` or `{ type: handler }`.
- `runFlow(flowId, withTrigger = false)` — start a paused flow.
- `pauseGroup(name)` / `runGroup(name)` — act on every flow in a group.
- `setLogger(logger)` — supply an object with `log()` and `error()`.
- `setOnAllComplete(fn)` — callback for the end of a run.
- `useEvents()` — enable DOM lifecycle events.
- `reset()` — clear run state. Registered types and plugin handlers survive, so
  a later `add()` and `load()` behave the same as the first run.
- `destroy()` — clear everything, including types and plugins. `init()` must be
  called again afterwards.
- `autoReset` — set to `false` to keep flow state after a run, for debugging.

## Types

Every type is a `{ type, handler }` pair. Handlers receive the process config
and return a promise.

| Type | Key fields |
| --- | --- |
| `script` | `src`, `module`, `async`, `defer`, `crossOrigin`, `integrity`, `bypassCache` |
| `inline-script` | `code`, `module` |
| `stylesheet` | `href`, `crossOrigin`, `bypassCache` |
| `style` | `code` |
| `pixel` | `src`, `dom`, `style` |
| `html` | `tag`, `html`, `id`, `className`, `style` |
| `shadow` | `tag`, `shadowData: { container, position, hidden }` |
| `console` | `message` — built in, used as the default type |

Common fields across types: `id`, `type`, `depends`, `condition`, `trigger`,
`priority`, `delay`, `data` (rendered as `data-*` attributes), `footer` (append
to `<body>` instead of `<head>`), and the callbacks `onBeforeStart`,
`onComplete`, `onError`.

Writing your own is a function returning a promise:

```js
core.registerType('json', (process) =>
    fetch(process.url)
        .then((r) => r.json())
        .then(process.onComplete)
);
```

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
| `triggers` | The eight trigger handlers above |
| `logger` | A console logger with readable message names |
| `events` | Re-dispatches `DOMContentLoaded` and `load` per process, so late-loaded third-party scripts that listen for them still initialise |
| `circ` | Detects circular dependencies and breaks them |
| `dynamic` | Defers processes added after `load()` into their own flows |
| `simple-events` | Re-dispatches `DOMContentLoaded` and `load` globally once everything completes |

```js
import core, { triggers, conditions, logger } from '@quietsapa/qsl';

core.use(triggers).use(conditions).use(logger);
```

## Events

Call `useEvents()` to enable them. Each carries the process config as `detail`.

`QSL:started`, `QSL:completed`, `QSL:error`, `QSL:skipped`,
`QSL:all:completed`.

## Security

**QSL treats its configuration as trusted, privileged input.** The
`inline-script` type executes code, the `html` type writes to `innerHTML`, and
several conditions compile regular expressions from strings. Never build a
configuration from untrusted input.

Read [SECURITY.md](SECURITY.md) before deploying. It covers the trust model,
Content Security Policy, and how to report a vulnerability.

## Development

```sh
npm install
npm test          # vitest + happy-dom
npm run build     # three bundles into dist/
```

`npm run check:version` guards against `VERSION` in `src/core.js` drifting away
from `package.json`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports with a reproduction are the
most useful thing you can send.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
