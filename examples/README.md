# Examples

Each folder is one self-contained page. Open `index.html` in a browser — there
is no build step and no server needed. They load QSL from a CDN, so they work
from a file you email to someone.

Every page starts with a comment block describing the problem it solves before
any code appears. If you are skimming to find the one that matches your
situation, read those.

Process configuration is written out literally, exactly as the
[README](../README.md) documents it. Nothing here builds config objects from a
helper — the point is to show what QSL actually takes.

All of them load QSL the non-blocking way:

```html
<script>
  window.QSLReady = function () { /* setup goes here */ };
</script>
<script async src="https://cdn.jsdelivr.net/npm/@quietsapa/qsl/dist/qsl.min.js?async=true"></script>
```

With `async` the tag never holds up the parser, but it also means
`window.__QSL__` does not exist yet when the inline script above it runs. The
`QSLReady` callback fires once QSL has initialised, which is why every example
does its work inside it. The main [README](../README.md#loading-qsl-without-blocking-the-parser)
covers the details.

Most examples also load a few small files from a `vendor/` folder next to
them. Those stand in for third-party tags: an external file is the realistic
case, since a vendor tag is not something you can edit.

To run them against your own checkout instead of the CDN, build first and point
the tag at the local file:

```sh
npm install && npm run build
```

```html
<script async src="../../dist/qsl.min.js?async=true"></script>
```

## [analytics-stack](analytics-stack/)

**An SDK and everything that depends on it.** Plugins that need the SDK's
global, setup calls that must run after it and in order, marketing that needs
the visitor id the setup produced. Three modes: everything loads; an ad
blocker removes the SDK, and the failure travels exactly as far as it should
while a fallback beacon records the visit; only a non-essential plugin fails,
and nothing else notices.

Covers: process and flow `depends`, `strict`, `ordered`, `between`,
`preload`, a process-level trigger combined with `depends`, a function
condition, `onError`, `pixel`, `QSL:error` and `QSL:skipped` with `reason`.

## [product-page](product-page/)

**Each widget loaded at the moment it becomes useful.** Nothing but QSL on
the first screen. Reviews when the section scrolls into view, the chat on
hover over its launcher or after 20 seconds, a desktop-only gallery
enhancement once the viewport is wide, recommendations when the cart drawer
is inserted, a history entry when the browser is idle.

Covers: `visible:`, `hover:`, `media:` as a trigger, `appears:`, `idle`,
`delay:`, all-of (array) and `or` combinations, process-level triggers, and
the `style`, `html`, `stylesheet`, `script` (with `data-*` and `footer`) and
`shadow` types.

## [audience-targeting](audience-targeting/)

**One configuration, different visitors.** Ads pixel for ad traffic, app
banners per mobile platform, support in the visitor's language, a notice for
European time zones, a debug flow switched on by a URL parameter. The page
shows what ran for you and why the rest was skipped.

Covers: `url:` (query and regex), `lang:`, `tz:`, `ua:` (device, os,
browser), `media:`, function conditions, arrays, `and` / `or` objects, and a
condition on a whole flow.

## [spa-navigation](spa-navigation/)

**Tags in a single-page app.** One QSL run per route change. A page view on
every route, route-specific tags that must not fire late on the wrong route,
a legacy vendor script that waits for `DOMContentLoaded` on every visit, and
navigation that happens while the previous run is still waiting.

Covers: repeated `load()` with automatic reset, conditions re-checked after a
trigger, late adds, the `events` plugin across runs, reused ids,
`setOnAllComplete`, and giving every wait a way out.

## [consent-groups](consent-groups/)

**A cookie banner where each category has two speeds.** Accepting "marketing"
should fire the conversion pixel at once, but the 300 kB chat widget in the
same category should still wait until the visitor engages. Two flows share one
group, `runGroup()` releases both, and only one of them has a trigger.

Also shows why the built-in `interaction` trigger is the wrong choice here —
the consent click is itself an interaction — and how a short function trigger
that ignores the consent UI fixes it. After accepting, consent can be
withdrawn per category.

Covers: `setFlowOptions`, `group`, `paused`, `runGroup`, `pauseGroup`,
function triggers.

## [legacy-domcontentloaded](legacy-domcontentloaded/)

**Why deferring a vendor script silently breaks it.** Countless third-party
scripts call `document.addEventListener('DOMContentLoaded', init)`, and plenty
wait for `window.load` instead. Load either one after its event has fired and
the callback never runs — no error, just a widget that never appears.

Four scripts load side by side, all of them late: inline code through QSL, an
external file through QSL listening for `DOMContentLoaded`, another external
file listening for `load`, and a fourth injected by hand with no QSL involved.
The first three work. The fourth is the control group, and it says nothing
about being dead.

Covers: the `events` plugin, `DOMContentLoaded` and `load` interception,
`script` and `inline-script` types, `trigger: 'load'` with a `delay`.

## [extending](extending/)

**Extending QSL, and seeing what it did.** Two custom types — an iframe, and
one that waits for a vendor global rather than for a file — a plugin adding
its own `scroll:` trigger and `network:` condition, a logger that writes into
the page, per-process timings from the lifecycle events, and a deliberately
misconfigured block showing what QSL does with a dependency cycle, a typo in
a dependency and an unknown type.

Covers: `registerType`, `use`, `setLogger`, `useEvents`, `autoReset`,
`reset`, `runFlow` on a paused flow, `priority`, dependency cycles.

## Ideas not written up yet

A/B test scripts that must run before first paint without flicker, and a
tag budget that measures what each third party costs. Contributions welcome —
a new example is one folder and one HTML file.
