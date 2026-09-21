import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        environmentOptions: {
            happyDOM: {
                /**
                 * No network in tests: scripts and stylesheets "load"
                 * successfully without being fetched. Tests that need a
                 * failure dispatch the error themselves.
                 */
                settings: {
                    disableJavaScriptFileLoading: true,
                    disableCSSFileLoading: true,
                    handleDisabledFileLoadingAsSuccess: true,
                },
            },
        },
        include: ['tests/**/*.test.js'],
        /**
         * happy-dom has no scheduler.yield(). QSL_SCHEDULER=1 adds one, so
         * the same suite also runs the way Chromium and Firefox do.
         */
        setupFiles: process.env.QSL_SCHEDULER ? ['./tests/setup/scheduler.js'] : [],
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.js'],
            reporter: ['text', 'html'],
            /**
             * Floors, not goals: a change that drops below them fails CI.
             */
            thresholds: {
                lines: 95,
                statements: 93,
                functions: 95,
                branches: 85,
            },
        },
    },
});
