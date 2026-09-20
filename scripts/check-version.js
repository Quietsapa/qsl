/**
 * Guard against the runtime VERSION constant drifting away from package.json.
 *
 * package.json is the single source of truth; src/core.js carries a literal so
 * that the browser bundle can report its own version without a build step
 * rewriting the source.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const core = fs.readFileSync(path.join(root, 'src', 'core.js'), 'utf-8');

const match = core.match(/VERSION:\s*['"]([^'"]+)['"]/);

if (!match) {
    console.error('check-version: no VERSION constant found in src/core.js');
    process.exit(1);
}

if (match[1] !== pkg.version) {
    console.error(
        `check-version: src/core.js VERSION is "${match[1]}" but package.json version is "${pkg.version}".\n` +
        'Update src/core.js so the two agree.'
    );
    process.exit(1);
}

console.log(`check-version: OK (${pkg.version})`);
