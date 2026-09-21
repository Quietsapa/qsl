# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-21

Writing the examples exercised far more of QSL than the tests did, and most of
this release is what that turned up. The theme is that every process now ends
in exactly one known state, and that state is reported.

### Changed

- **The `interaction` trigger lives in the `triggers` plugin** as
  `interactionTrigger`, like every other built-in trigger. It used to be a
  fallback wired into the core, which made it the one trigger the slim bundle
  understood. In the slim bundle, `trigger: 'interaction'` and `trigger: true`
  are now unknown and, like any unknown trigger, do not hold the process back.
  The `qsl.waitForInteraction()` method is gone; use `trigger: 'interaction'`,
  or write a function trigger for anything more specific.
- **Late adds and dependency cycles are handled by the core.** Both were
  plugins, `dynamic` and `circ`, but neither is optional behaviour: without
  the first, a process added after `load()` silently never ran; without the
  second, a cycle in `depends` made `load()` wait forever. The `dynamic` and
  `circ` exports are gone — remove any `use(dynamic)` or `use(circ)`. The
  slim bundle now handles both as well.
- **Every process settles exactly once: completed, failed or skipped.** Each
  fires one event — `QSL:completed`, `QSL:error` or `QSL:skipped` — and each
  releases whatever depends on it. See the fixes below for what was broken
  before.
- **Built-in types reject when the resource fails to load.** They used to
  resolve with the error, so a script that 404'd or was blocked counted as
  completed and fired `QSL:completed`. It now fires `QSL:error`, with the
  element's `error` event as `detail.error`. The `shadow` type rejects when
  its container is missing, instead of resolving with an `Error`. Custom types
  that already rejected on failure behave as before.
- **`QSL:error` fires once per failed process, with the documented
  `detail`.** The built-in types used to dispatch their own `QSL:error` on
  every failure, even without `useEvents()`, with a different `detail` shape
  (`{ tag, type, config }`). With `useEvents()` on, that meant two events per
  failure — and a custom type that rejected made QSL's own listener throw.
  The types no longer dispatch it; QSL logs the failure and fires `QSL:error`
  itself, through `useEvents()` like every other lifecycle event. If you
  listened for `QSL:error` without calling `useEvents()`, call it now.
- **A process checks its condition again right before it runs**, after its
  trigger has fired and its dependencies have settled. Flows already did this
  after their trigger. A popup waiting on a delay no longer appears after the
  visitor has left the page it was meant for.
- **`runFlow()` starts a flow that was added with `paused: true`.** The
  README said it would; it did nothing, because the flow stayed paused. Only
  `runGroup()` worked, since it un-paused first.
- **An unknown type settles the process as failed** and fires `QSL:error`.
  It used to finish silently with no event at all.

### Added

- **`strict`**, on a process, on a flow, or on the instance (`qsl.strict`),
  nearest setting wins, default `false`. A strict process is skipped when a
  dependency failed or was skipped, without waiting for its own trigger; a
  strict flow is skipped when a flow it depends on was skipped or had a
  failure inside it. Skips cascade. Without `strict`, `depends` keeps its old
  meaning: wait until the dependency has finished, however it finished.
- `QSL:skipped` carries `detail.reason`: `'condition'`, `'dependency'` or
  `'circular'`. `QSL:error` carries `detail.error`.
- The logger reports skipped processes, with the reason.
- A test suite that goes through every condition operator, trigger, type
  and flow option, the lifecycle events, the plugin hooks and both browser
  presets — around 300 tests, most of them tables of variations. CI now runs
  it with coverage floors (`npm run test:coverage`).
- Five new examples — analytics-stack, product-page, audience-targeting,
  spa-navigation and extending — alongside consent-groups (now with
  withdrawing consent) and legacy-domcontentloaded. Together they cover
  nearly every option in the README.

### Removed

- `EVENTS.FLOW_STARTED` and `EVENTS.FLOW_COMPLETED`. Nothing ever fired them.
- **The `simple-events` plugin.** It re-dispatched `DOMContentLoaded` and
  `load` globally once a run completed. A dispatched event reaches every
  listener still registered, not only the late ones, so any page code that
  had already initialised on the real event — a theme script, a plain
  `addEventListener('DOMContentLoaded', init)` — ran a second time, and again
  on every later run. Only listeners registered with `{ once: true }` or that
  remove themselves were spared. Use the `events` plugin, which renames the
  event only for listeners registered by a late-loaded process. The
  `simpleEvents` export is gone; importing it is now an error.

### Fixed

- **`tz:offset:` never matched a zone that is not a whole number of hours**
  (India, Iran, parts of Australia): the value was read with `parseInt`.
- **`url:query:key=value` cut the value at a second `=`,** so a value like
  `a=b` never matched.
- **`ua:device:mobile` matched tablets.** An iPad sends `Mobile/…` in its user
  agent and an Android tablet sends `Android`; both counted as phones. Tablets
  are now recognised first.
- **`ua:os:mac` matched iPhones and iPads,** whose user agents say "like Mac
  OS X".
- **The `pixel` type ignored `dom: false`.** It always inserted the image into
  `<head>`. With `dom: false` it now makes the request without inserting
  anything, and still reports load or failure.
- **Code that threw could hang the whole run.** A type handler that threw,
  or returned something other than a promise; a condition or trigger function
  that threw; a flow's `beforeStart` or `onComplete`, or a process's
  `onComplete`, that threw — each left a process or flow unfinished, and
  `load()` never resolved. Now a throwing handler fails the process, a
  throwing condition fails the condition, a throwing trigger lets the flow or
  process go ahead, and a throwing callback is logged (or, from the built-in
  types, rethrown as an uncaught error) without affecting the run.
- **Adding the same config object again broke it.** `add()` wrote its run
  state onto the object it was given, so adding a stored config a second time
  — once per route in a single-page app, say — produced a `qsl-qsl-` id and a
  process already marked finished, which never ran and held the run open.
  `add()` now works on a copy.
- **A flow created during a run never started, and the run never
  completed.** Only a process added with no flow was picked up after the run
  had begun; `add(config, 'chat')` or `setFlowOptions({...}, 'chat')` for a
  new flow left it waiting forever, and `load()` with it. Every flow created
  during a run is now a late flow, with its own options respected: a paused
  one waits for `runFlow()`, one with a trigger waits for the trigger, and
  neither holds up the late flows after it.
- **A process added to a flow that had already started never ran.** The
  flow runs from the list it had when it started, so the process was pushed
  into an array nobody read again, and the run completed without it. It now
  gets a late flow carrying over the started flow's `condition`, `strict`,
  `fireEvents` and `group`, and the logger reports it as `LATE_ADD`.
- **A flow whose id contained `dynamic` was treated as a late add.** The
  plugin recognised its own flows by that substring, so a flow named, say,
  `dynamic-pricing` was held back until every other flow finished. Late adds
  are now tracked by the core itself.
- **Everything that depended on a cycle was skipped as circular too.** With
  C depending on A, and A and B depending on each other, C was skipped along
  with them. Only the members of a cycle are skipped now; C settles by the
  usual rules — it runs, or with `strict` it is skipped with reason
  `'dependency'`.
- **A process skipped by its condition hung everything that depended on
  it.** It returned without ever being marked as finished, so a dependent
  waited forever and `load()` never resolved. It also never fired
  `QSL:skipped`: the only code that set the flag behind that event was the
  `media:` trigger, and only in browsers without `matchMedia`.
- **A flow skipped by its condition, or broken by the `circ` plugin, left
  its processes unsettled**, with the same result for any process in another
  flow that depended on one of them.
- **`pauseGroup()` did not hold a flow that was waiting for its trigger.**
  The trigger un-paused the flow when it fired, so withdrawing consent before
  a deferred tag's interaction arrived did not stop it. `paused` now only
  means a pause someone asked for: a flow waiting for its trigger or its
  dependencies is tracked separately, so neither can release a paused flow.
  Only `runFlow()` or `runGroup()` does. Setting `depends` on a flow no longer
  sets `paused` on it.
- **`runGroup()` started flows before the flows they depend on had
  finished.**
- **`preload` never emitted anything for stylesheets.** It checked for a type
  named `style` with an `href`; the stylesheet type is `stylesheet`.
- **`waitForInteraction()` called back once per kind of interaction.** Each
  event type had its own `once` listener, so a mousemove followed by a click
  called the callback twice, and the listeners for the remaining types stayed
  registered for the life of the page. It now calls back once and removes all
  of them. The built-in `interaction` trigger was not affected in practice,
  because a flow only starts once, but a function trigger or any direct caller
  was. (The method has since been removed; see Changed.)

## [0.1.5] - 2026-09-21

### Fixed

- **The `events` plugin left a permanent mark on `document` and `window`.** On
  reset it assigned the saved `addEventListener` back to each object. The method
  normally comes from `EventTarget.prototype`, so that assignment created an own
  property that shadowed the prototype for the rest of the page's life. An APM,
  RUM or session-replay SDK that instruments the prototype after QSL had run
  never saw listeners added to `document` or `window`. The plugin now restores
  the exact previous state: it deletes the property when there was none before.
- **Reset removed other scripts' wrappers.** If a script loaded during a run
  wrapped `addEventListener` on top of QSL's wrapper, reset overwrote it with
  the saved original and that script's instrumentation silently stopped. QSL now
  leaves a wrapper it does not own in place. Its own wrapper stays in the chain
  underneath as a pass-through while no run is active, and resumes intercepting
  when the next run starts.
- **The wrapper ignored the receiver.** It was an arrow function that called
  the saved method bound to `document` or `window` regardless of what the caller
  passed as `this`, which broke `addEventListener.call(otherTarget, ...)` during
  a run. The original is now called with the caller's receiver.

### Added

- Tests covering the patch lifecycle: own-property state after a run, a
  prototype patch installed afterwards, a wrapper stacked on top during a run,
  interception resuming in the next run, and the receiver.

## [0.1.4] - 2026-09-20

### Fixed

- **Two processes sharing an id woke each other's listeners.** The private
  event the `events` plugin dispatches was named after the process id, and ids
  are not unique: the same explicit id appears again in a later `load()` cycle,
  or in a late add that the `dynamic` plugin puts in its own flow. The second
  process then dispatched an event the first one's listener was still bound to,
  so that listener ran a second time. The name is now keyed to the process
  instance. Listeners belonging to one process still share a name, so a single
  dispatch continues to serve all of them.

### Changed

- **The full browser bundle now registers the `dynamic` plugin.** It was listed
  in the README alongside the others but built into neither bundle, so for
  anyone loading QSL from a CDN a process added after `load()` silently did
  nothing. The bundle grows by about 0.2 kB gzipped. Behaviour changes for
  those users: a late add now runs once the regular flows finish, where before
  it was dropped.

## [0.1.3] - 2026-09-20

### Fixed

- **The `events` plugin delivered each intercepted event more than once.** It
  dispatched the renamed `DOMContentLoaded` / `load` event in two places: a
  microtask queued from the patched `addEventListener`, and again when the
  process completed. A vendor script with one listener saw it fire twice; with
  three listeners, each fired four times, because the microtask was queued once
  per registration while the completion dispatch fired once in total. For a
  real tag that means duplicate page views, duplicate widgets and duplicate
  conversions. The rename still happens at registration, but the event is now
  dispatched only on process completion, which is the path that deduplicates.

### Added

- Tests covering the `events` plugin, including the multiple-listener case that
  the duplicate dispatch made worst.

## [0.1.2] - 2026-09-20

### Fixed

- `init()` now captures `document.currentScript` before its first `await`
  rather than after. `currentScript` is only set while a script runs
  synchronously, so any plugin init action that waits on something genuinely
  asynchronous would have left it `null` and the `?async=true` ready callback
  would have silently never fired. No shipped plugin awaits anything today, so
  this fixes a latent fault rather than an observable one.

### Added

- A README section on loading QSL with `async` and the `QSLReady` callback,
  including why the callback is needed and the three ways to get it wrong.

## [0.1.1] - 2026-09-20

### Fixed

- **The `dynamic` plugin never did anything.** Three faults stacked up. It set
  a flow to `RUNNING` immediately before handing it to `runFlow()`, which only
  accepts a `READY` flow and therefore returned at once. Its own flow-id filter
  then stripped dynamic flows out even when one was requested by name. And
  above both, `maybeComplete()` returned before reaching any completion hook
  unless every flow was already `COMPLETED` — which a waiting dynamic flow
  prevents by definition, so the plugin's hook was unreachable. A process added
  after `load()` now runs once the regular flows finish, and `load()` resolves
  instead of hanging.
- **`hover:` listens for `mouseover` again.** 0.1.0 changed it to `mouseenter`
  without saying so in this file. `mouseover` bubbles and matches the behaviour
  the trigger has always had, so the change is reverted rather than documented.

### Changed

- **`completedFlowsActions` hooks now run even when some flow is still
  outstanding.** They receive `flowsDone` as before and decide for themselves:
  return `false` to hold completion back, or pass `flowsDone` straight through
  when there is nothing to defer. With no hooks registered the behaviour is
  unchanged — a run completes when every flow completes. Any custom hook
  written against 0.1.0 must now return `flowsDone` rather than `true` in its
  "nothing to do" branch, or it will complete a run early.

### Added

- Tests covering the `dynamic` plugin, including the case where a late add must
  wait for the regular flows and the case where it is ignored without the
  plugin.

## [0.1.0] - 2026-09-20

First public release. The runtime is extracted from a private codebase, so
this entry records the differences from that internal version rather than a
list of new features.

### Fixed

- **`media:` trigger never worked.** The handler referenced an undeclared
  variable instead of the query string. Because `typeof` on an undeclared
  identifier is safe, it silently took the "skip" branch every time rather than
  throwing. The query is now read from the option and passed to `matchMedia`.
- **`visible:` and `appears:` triggers hung the run.** Both listened for DOM
  events named `intersection` and `mutation`, which do not exist. When the
  target element was present, the callback never fired, the flow stayed paused
  and the load never completed. They now use `IntersectionObserver` and
  `MutationObserver`. `appears:` also waits for elements that are inserted
  later, instead of firing immediately when the selector does not match yet.
- **Selectors containing a colon were truncated.** `hover:`, `visible:` and
  `appears:` parsed their argument with `split(':')[1]`, which broke
  `hover:.btn:first-child` and any media query. Arguments are now read by
  prefix length.
- **`domready` trigger could hang.** It only fired immediately when
  `readyState` was `complete`; at `interactive`, `DOMContentLoaded` had already
  been dispatched, so the listener it added never ran.
- **`shadow` type threw when its container was missing.** A local
  `const error = new Error(...)` shadowed the module-level `error()` helper, so
  the error path raised a `TypeError` instead of reporting the failure. A
  missing or absent `container` now resolves with an `Error`.
- **`fire('SKIPPED', ...)` was a silent no-op.** There was no `SKIPPED` entry in
  the event map. Added as `QSL:skipped`.
- **`registerTypes()` rejected the object form** documented in its JSDoc, and
  both `registerType` and `registerTypes` returned `undefined` on invalid input,
  breaking the chaining contract. The same applied to `runFlow`, `pauseGroup`
  and `runGroup`.

### Changed

- **`reset()` no longer clears plugin registrations.** It previously wiped
  registered types, condition handlers, trigger handlers and every lifecycle
  hook along with the run state. Since `reset()` runs automatically once all
  flows complete, the runtime was effectively dead for any process added
  afterwards. `reset()` now clears run state only; the new `destroy()` performs
  the full teardown.
- **`reset()` no longer skips its work when a logger is set.** Debugging
  behaviour is controlled by the new `autoReset` property instead.
- Identifiers interpolated into the `inline-script` module wrapper are
  serialised with `JSON.stringify`, so a hostile `flowId` or process id cannot
  break out of its string literal.

### Added

- `destroy()` for a full teardown, and `autoReset` to keep flow state after a
  run.
- Vitest test suite covering the fixes above.
- Three published builds: ESM library, full browser bundle, slim browser
  bundle.

### Removed

- The service-specific build pipeline: manifest generation, CDN deployment and
  the internal bundle-composition map. Those stay in the private repository;
  this one ships only the runtime.

[Unreleased]: https://github.com/Quietsapa/qsl/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Quietsapa/qsl/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/Quietsapa/qsl/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Quietsapa/qsl/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Quietsapa/qsl/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Quietsapa/qsl/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Quietsapa/qsl/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Quietsapa/qsl/releases/tag/v0.1.0
