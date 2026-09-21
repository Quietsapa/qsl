/**
 * Fail the build when a browser bundle grows past its budget.
 *
 * QSL ends up on other people's pages, so its size is part of the contract.
 * The budgets leave some room for growth; raising one should be a decision
 * made in review, not something that happens by accident.
 *
 * Sizes are gzip at the highest level, in kB of 1000 bytes, the same unit
 * vite prints.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const budgets = {
    'dist/qsl.min.js': 10,
    'dist/qsl.slim.min.js': 6,
};

let failed = false;

for (const [file, budget] of Object.entries(budgets)) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) {
        console.error(`check-size: ${file} is missing — run \`npm run build\` first.`);
        failed = true;
        continue;
    }

    const size = zlib.gzipSync(fs.readFileSync(full), { level: 9 }).length / 1000;
    const ok = size <= budget;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'OVER'}  ${file}  ${size.toFixed(2)} kB gzip  (budget ${budget} kB)`);
}

if (failed) process.exit(1);
