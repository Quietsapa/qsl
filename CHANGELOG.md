# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Quietsapa/qsl/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Quietsapa/qsl/releases/tag/v0.1.0
