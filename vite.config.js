import { defineConfig } from 'vite';
import path from 'node:path';
import url from 'node:url';
import { readFileSync } from 'node:fs';

const root = path.dirname(url.fileURLToPath(import.meta.url));
const resolve = (p) => path.resolve(root, p);

/**
 * Three build passes, selected with `--mode`:
 *
 *   esm          library entry, unminified ESM, nothing is registered or
 *                started on import. This is what `import '@quietsapa/qsl'` resolves to.
 *   browser      batteries-included IIFE for a <script> tag or a CDN. Registers
 *                every type, condition and trigger, then calls init().
 *   browser-slim same, but only the `script` and `inline-script` types. Use
 *                it when the page just needs scripts, files and snippets, in order.
 *
 * Run all three with `npm run build`.
 */
const targets = {
    esm: {
        entry: resolve('src/index.js'),
        formats: ['es'],
        fileName: () => 'qsl.mjs',
        minify: false,
        emptyOutDir: true,
    },
    browser: {
        entry: resolve('src/presets/full.js'),
        formats: ['iife'],
        fileName: () => 'qsl.min.js',
        minify: 'terser',
        emptyOutDir: false,
    },
    'browser-slim': {
        entry: resolve('src/presets/default.js'),
        formats: ['iife'],
        fileName: () => 'qsl.slim.min.js',
        minify: 'terser',
        emptyOutDir: false,
    },
};

/**
 * The licence header every bundle keeps. `/*!` is the convention minifiers,
 * ours and anyone else's, leave in place.
 */
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const year = new Date().getFullYear();
const years = year > 2026 ? `2026-${year}` : '2026';
const holder = pkg.author.replace(/\s*<[^>]*>/, '');
const banner = `/*! QSL v${pkg.version} | (c) ${years} ${holder} | ${pkg.license} | github.com/Quietsapa/qsl */`;

export default defineConfig(({ mode }) => {
    const target = targets[mode] || targets.esm;

    return {
        build: {
            outDir: 'dist',
            emptyOutDir: target.emptyOutDir,
            minify: target.minify,
            sourcemap: true,
            target: 'es2019',
            lib: {
                entry: target.entry,
                formats: target.formats,
                fileName: target.fileName,
                name: 'QSL',
            },
            rollupOptions: {
                output: { banner },
            },
            terserOptions: {
                format: { comments: false, preamble: banner },
            },
        },
    };
});
