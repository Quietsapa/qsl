# Security

## Trust model

**QSL treats its configuration as trusted, privileged input — equivalent to
code you wrote yourself.**

This is the single most important thing to understand before deploying it. The
library is a loader: its entire job is to turn a declarative description into
scripts, styles and elements on the page. Several of its features are therefore
code execution by design, not by accident:

| Surface | What it does |
| --- | --- |
| `inline-script` type | Injects `config.code` as a `<script>` element. It runs. |
| `script` type | Loads and runs `config.src`. |
| `html` type | Assigns `config.html` to `innerHTML`. |
| `style` / `stylesheet` types | Injects CSS from `config.code` / `config.href`. |
| `url:matches`, `url:pathMatches`, `ua:matches` conditions | Compile `new RegExp(...)` from the option string. |
| `condition` / `trigger` as a function | Called directly. |

Consequences you must design around:

1. **Never build a configuration from untrusted input.** Query-string
   parameters, `postMessage` payloads, user-submitted form fields, third-party
   API responses and CMS fields editable by low-privilege users are all
   untrusted. Anything that reaches `add()` can run arbitrary JavaScript in the
   page's origin.
2. **The `<script>` tag stripping in `inline-script` and `style` is not
   sanitisation.** `config.code.replace(/<script.*?>|<\/script>/gi, '')` exists
   to make copy-pasted snippets work, not to make hostile input safe. Do not
   rely on it as a security boundary.
3. **A regular expression from a configuration can hang the page.** A
   catastrophically backtracking pattern in `url:matches` is a denial of
   service against your own visitors. Keep patterns simple, or validate them
   before they reach the browser.
4. **`window.__QSL__` is a writable global.** Any script on the page — including
   ones QSL itself loaded — can read and mutate the loader's state. If that
   matters for your threat model, load QSL in a context you control and
   treat every other script on the page as able to interfere with it.

Identifiers are handled more carefully than content. The `module` variant of
`inline-script` builds a wrapper function as source text; `flowId`, the process
id and the internal event name are serialised with `JSON.stringify` so that a
hostile identifier cannot break out of its string literal. The script body
itself is, by definition, executed as written.

## Content Security Policy

QSL does not use `eval` or `new Function`. It works under a CSP without
`unsafe-eval`.

Inline code is a different matter. The `inline-script` and `style` types create
elements with inline content, so a policy that forbids `'unsafe-inline'`
requires a nonce or hash for them. There is currently no built-in nonce
support; if you need it, pass one through `data` or open an issue describing
your setup. The `script`, `stylesheet`, `pixel`, `shadow` and `html` types work
under a strict policy as long as the origins they reference are allowed.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's **Security → Report a vulnerability**
form on this repository. Include the affected version, what an attacker can
achieve, and a reproduction if you have one.

Expect an acknowledgement within a week. Fixes for confirmed issues are
released on the current minor version, with credit in the changelog unless you
ask otherwise.

Findings that amount to "a malicious configuration can execute JavaScript" are
documented behaviour and described above; they are not treated as
vulnerabilities. A way to escape a configuration value that is supposed to be
inert — an identifier, a selector, an attribute name — is.

## Supported versions

While the project is pre-1.0, only the latest published version receives
security fixes.
