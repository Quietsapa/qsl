import { describe, it, expect, vi, afterEach } from 'vitest';
import { urlCondition, languageCondition, userAgentCondition } from '../src/plugins/conditions.js';
import { resolveCondition } from './helpers.js';

/**
 * Core's convention: a handler returns `true` when the condition FAILS, which
 * is what makes the process skip. `false` means the condition passed.
 */

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('url condition', () => {
    it('passes when the path matches', () => {
        expect(resolveCondition(urlCondition, `url:pathStartsWith:${window.location.pathname}`)).toBe(false);
    });

    it('fails when the path does not match', () => {
        expect(resolveCondition(urlCondition, 'url:pathStartsWith:/definitely-not-here')).toBe(true);
    });

    it('ignores options it does not own', () => {
        expect(resolveCondition(urlCondition, 'lang:is:en')).toBeNull();
    });

    it('fails closed on an invalid regular expression', () => {
        expect(resolveCondition(urlCondition, 'url:matches:[')).toBe(true);
    });
});

describe('language condition', () => {
    it('matches the navigator language', () => {
        vi.stubGlobal('navigator', { ...navigator, language: 'ru-RU' });
        expect(resolveCondition(languageCondition, 'lang:startsWith:ru')).toBe(false);
        expect(resolveCondition(languageCondition, 'lang:is:en-US')).toBe(true);
    });

    it('supports a comma separated list', () => {
        vi.stubGlobal('navigator', { ...navigator, language: 'de-DE' });
        expect(resolveCondition(languageCondition, 'lang:in:de-DE, fr-FR')).toBe(false);
    });
});

describe('user agent condition', () => {
    it('detects a device class', () => {
        vi.stubGlobal('navigator', {
            ...navigator,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
        });
        expect(resolveCondition(userAgentCondition, 'ua:device:mobile')).toBe(false);
        expect(resolveCondition(userAgentCondition, 'ua:device:desktop')).toBe(true);
    });
});
