// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * README.md and types/index.d.ts describe the same API. These tests read
 * both and fail when one of them gains or loses a field the other lacks.
 */
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const dts = readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8');

/**
 * The top-level fields of an interface in the declarations.
 */
function fields(name) {
    const start = dts.search(new RegExp(`export interface ${name}\\b[^{]*\\{`));
    if (start === -1) throw new Error(`interface ${name} not found`);
    const body = dts.slice(dts.indexOf('{', start) + 1, dts.indexOf('\n}', start));
    return [...body.matchAll(/^ {4}(?:readonly )?([A-Za-z_]\w*)\??[:(<]/gm)].map((m) => m[1]);
}

/**
 * The backticked names in a README table row or sentence.
 */
const names = (text) => [...new Set([...text.matchAll(/`(\w+)/g)].map((m) => m[1]))];

describe('README and types agree', () => {
    it('on flow options', () => {
        const table = readme.slice(readme.indexOf('| Option | Default | Meaning |'), readme.indexOf('### Other methods'));
        const documented = [...table.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
        const declared = fields('FlowOptions').filter((f) => !['beforeStart', 'onComplete'].includes(f));
        expect(documented.sort()).toEqual(declared.sort());
    });

    it('on the fields every process has', () => {
        const start = readme.indexOf('Common fields across types:');
        const documented = names(readme.slice(start, readme.indexOf('\n\n', start))).filter((f) => !['type', 'true', 'false'].includes(f));
        expect(documented.sort()).toEqual(fields('ProcessOptions').sort());
    });

    it.each([
        ['script', 'ScriptProcess'],
        ['inline-script', 'InlineScriptProcess'],
        ['stylesheet', 'StylesheetProcess'],
        ['style', 'StyleProcess'],
        ['pixel', 'PixelProcess'],
        ['html', 'HTMLProcess'],
        ['shadow', 'ShadowProcess'],
        ['console', 'ConsoleProcess'],
    ])('on the fields of %s', (type, name) => {
        const row = readme.match(new RegExp('^\\| `' + type + '` \\| (.+) \\|$', 'm'))[1];
        const documented = names(row.replace(/:\s*\{[^}]*\}/, '')).filter((f) => f !== 'id');
        const declared = fields(name).filter((f) => f !== 'type');
        expect(documented.sort()).toEqual(declared.sort());
    });

    it('on instance settings', () => {
        const start = readme.indexOf('### Other methods');
        const list = readme.slice(start, readme.indexOf('\n## ', start));
        const documented = [...list.matchAll(/^- `(\w+)` —/gm)].map((m) => m[1]);
        for (const setting of ['autoReset', 'strict', 'timeout', 'retries', 'retryDelay', 'yield']) {
            expect(documented, setting).toContain(setting);
            expect(fields('QSL'), setting).toContain(setting);
        }
    });

    it('on the methods', () => {
        const start = readme.indexOf('## API');
        const api = readme.slice(start, readme.indexOf('\n## Types', start));
        /**
         * `log()` and `error()` are mentioned as the logger's own methods.
         */
        const documented = new Set([...api.matchAll(/`(\w+)\(/g)].map((m) => m[1]).filter((m) => !['log', 'error'].includes(m)));
        const declared = fields('QSL');
        for (const method of documented) expect(declared, method).toContain(method);
    });
});
