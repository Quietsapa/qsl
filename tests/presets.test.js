import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The browser bundles are built from these presets. What they register is
 * what a CDN user gets, so check it directly.
 */

async function loadPreset(name) {
    vi.resetModules();
    delete window.__QSL__;
    await import(`../src/presets/${name}.js`);
    /**
     * init() is async; let it finish.
     */
    await new Promise((r) => setTimeout(r, 0));
    return window.__QSL__;
}

beforeEach(() => {
    delete window.__QSL__;
});

describe('full preset', () => {
    it('registers every type, plus the built-in console type', async () => {
        const qsl = await loadPreset('full');
        expect([...qsl.types.keys()].sort()).toEqual(
            ['console', 'html', 'inline-script', 'pixel', 'script', 'shadow', 'style', 'stylesheet']
        );
    });

    it('registers all nine triggers and all five conditions', async () => {
        const qsl = await loadPreset('full');
        expect(qsl.triggerHandlers.size).toBe(9);
        expect(qsl.conditionHandlers.size).toBe(5);

        for (const trigger of ['interaction', true, 'load', 'idle', 'domready', 'delay:1', 'hover:#x', 'visible:#x', 'appears:#x', 'media:(min-width: 1px)']) {
            expect(qsl.getTriggerFunction(trigger, {}), String(trigger)).toBeTypeOf('function');
        }
    });

    it('is initialised, with the logger and the events plugin in place', async () => {
        const qsl = await loadPreset('full');
        expect(qsl.initialized).toBe(true);
        expect(qsl.logger?.VERSION).toBe('qsl-logger');
        expect(qsl.customEvents).toBeInstanceOf(Map);
    });
});

describe('slim preset', () => {
    it('registers the script and inline-script types only, and no triggers or conditions', async () => {
        const qsl = await loadPreset('default');
        expect([...qsl.types.keys()].sort()).toEqual(['console', 'inline-script', 'script']);
        expect(qsl.triggerHandlers.size).toBe(0);
        expect(qsl.conditionHandlers.size).toBe(0);
        expect(qsl.initialized).toBe(true);
    });
});

describe('ESM entry', () => {
    it('registers and starts nothing on import', async () => {
        vi.resetModules();
        const mod = await import('../src/index.js');
        expect(mod.default.initialized).toBe(false);
        expect(mod.default.types.size).toBe(0);
        expect(mod.default).toBe(mod.core);
    });

    it('exports every plugin and type the README lists', async () => {
        const mod = await import('../src/index.js');
        for (const name of [
            'Script', 'Stylesheet', 'InlineScript', 'InlineStyle', 'Pixel', 'Shadow', 'HTML',
            'conditions', 'mediaQueryCondition', 'languageCondition', 'timezoneCondition', 'urlCondition', 'userAgentCondition',
            'triggers', 'interactionTrigger', 'loadTrigger', 'idleTrigger', 'domReadyTrigger', 'delayTrigger',
            'hoverTrigger', 'visibleTrigger', 'appearsTrigger', 'mediaQueryTrigger',
            'logger', 'events',
        ]) {
            expect(mod[name], name).toBeDefined();
        }
        for (const removed of ['simpleEvents', 'circ', 'dynamic', 'waitForInteraction']) {
            expect(mod[removed], removed).toBeUndefined();
        }
    });
});
