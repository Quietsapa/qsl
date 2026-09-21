# Contributing

Thanks for taking the time. Bug reports with a reproduction are the most
useful contribution; pull requests are welcome too.

## Getting set up

```sh
git clone https://github.com/Quietsapa/qsl.git
cd qsl
npm install
npm test
```

Node 22.12 or newer for development: the test and build tools need it, the
library itself runs in any browser. There are no runtime dependencies and
there will not be any — this library ends up on other people's pages, and
every dependency is something they have to audit.

`npm run test:e2e` drives the examples in headless Chromium. Run
`npx playwright install chromium` once before the first time. Where
Playwright has no Chromium build for your system (macOS 12, for instance),
the script uses your installed Google Chrome instead.

## Reporting a bug

Include the version, the browser, a minimal configuration that reproduces the
problem, and what you expected instead. A process or flow that never completes
is almost always a trigger that never fires; say which trigger you used.

For anything with security impact, do not open a public issue. Follow
[SECURITY.md](SECURITY.md).

## Pull requests

- One change per pull request.
- Add a test. `tests/` uses Vitest with happy-dom; the existing files show the
  patterns, including how to get a fresh core instance and how to resolve a
  single trigger or condition handler without booting the whole runtime.
- Run `npm run test:coverage` and `npm run build` before pushing. CI fails
  when coverage drops below the floors in `vitest.config.js`.
- Match the surrounding style: four spaces, single quotes, semicolons, JSDoc on
  anything exported. There is no linter; the `.editorconfig` covers the
  mechanical part.
- Do not add runtime dependencies.

### Things that need extra discussion first

Open an issue before starting on any of these, so you do not spend an evening
on something that gets turned down:

- New resource types. The core set is deliberately small; a type that wraps one
  specific vendor's snippet belongs in your own project, not here.
- Anything that changes the shape of a process or flow config.
- Anything that loosens the security posture described in SECURITY.md.

## Commit messages

Plain imperative subject lines: `fix media trigger dropping its query`. No
required prefix scheme.

## Licensing of contributions

By submitting a pull request you agree that your contribution is licensed under
the Apache License 2.0, as stated in section 5 of the license. There is no
separate CLA to sign.
