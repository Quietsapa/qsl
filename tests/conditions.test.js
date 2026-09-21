import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    mediaQueryCondition,
    languageCondition,
    timezoneCondition,
    urlCondition,
    userAgentCondition,
} from '../src/plugins/conditions.js';
import { resolveCondition } from './helpers.js';

/**
 * Core's convention: a handler returns `true` when the condition FAILS, which
 * is what makes the process skip. `false` means the condition passed, and
 * `null` means the option belongs to some other handler.
 */

const PASS = false;
const FAIL = true;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0',
    linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 OPR/110.0',
    chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

function withUserAgent(userAgent) {
    vi.stubGlobal('navigator', { ...navigator, userAgent });
}

function withLanguage(language) {
    vi.stubGlobal('navigator', { ...navigator, language });
}

function withTimezone(timeZone, offsetMinutes) {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone });
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(offsetMinutes);
}

function withUrl(url) {
    window.happyDOM.setURL(url);
}

describe('every condition handler', () => {
    it.each([
        ['media', mediaQueryCondition, 'lang:is:en'],
        ['lang', languageCondition, 'url:path:/'],
        ['tz', timezoneCondition, 'lang:is:en'],
        ['url', urlCondition, 'tz:is:UTC'],
        ['ua', userAgentCondition, 'media:(min-width: 1px)'],
    ])('%s ignores options it does not own', (_, handler, foreign) => {
        expect(resolveCondition(handler, foreign)).toBeNull();
        expect(resolveCondition(handler, () => true)).toBeNull();
        expect(resolveCondition(handler, true)).toBeNull();
    });
});

describe('media condition', () => {
    it.each([
        [true, PASS],
        [false, FAIL],
    ])('matches=%s → %s', (matches, expected) => {
        const seen = [];
        vi.stubGlobal('matchMedia', (query) => { seen.push(query); return { matches }; });
        expect(resolveCondition(mediaQueryCondition, 'media:(min-width: 768px)')).toBe(expected);
        expect(seen).toEqual(['(min-width: 768px)']);
    });
});

describe('language condition', () => {
    it.each([
        ['lang:is:ru-RU', 'ru-RU', PASS],
        ['lang:is:ru-RU', 'ru', FAIL],
        ['lang:equals:en-US', 'en-US', PASS],
        ['lang:contains:RU', 'ru-RU', PASS],
        ['lang:contains:de', 'ru-RU', FAIL],
        ['lang:startsWith:ru', 'ru-RU', PASS],
        ['lang:startsWith:en', 'ru-RU', FAIL],
        ['lang:in:de-DE, fr-FR', 'de-DE', PASS],
        ['lang:in:de-DE,fr-FR', 'fr-FR', PASS],
        ['lang:in:de-DE,fr-FR', 'en-US', FAIL],
        ['lang::en-US', 'en-US', PASS],
        ['lang:unknown:en', 'en', FAIL],
    ])('%s with %s', (opt, language, expected) => {
        withLanguage(language);
        expect(resolveCondition(languageCondition, opt)).toBe(expected);
    });
});

describe('timezone condition', () => {
    it.each([
        ['tz:is:Europe/Moscow', 'Europe/Moscow', -180, PASS],
        ['tz:equals:Europe/Moscow', 'Europe/Berlin', -60, FAIL],
        ['tz:contains:Europe', 'Europe/Berlin', -60, PASS],
        ['tz:contains:America', 'Europe/Berlin', -60, FAIL],
        ['tz:offset:3', 'Europe/Moscow', -180, PASS],
        ['tz:offset:3', 'Europe/Berlin', -60, FAIL],
        ['tz:offset:-5', 'America/New_York', 300, PASS],
        ['tz:offset:0', 'UTC', 0, PASS],
        ['tz:offset:5.5', 'Asia/Kolkata', -330, PASS],
        ['tz:offset:5', 'Asia/Kolkata', -330, FAIL],
        ['timezone:is:UTC', 'UTC', 0, PASS],
        ['tz:unknown:x', 'UTC', 0, FAIL],
    ])('%s in %s', (opt, zone, offset, expected) => {
        withTimezone(zone, offset);
        expect(resolveCondition(timezoneCondition, opt)).toBe(expected);
    });
});

describe('url condition', () => {
    const URL = 'https://shop.example.com/blog/post-1.html?utm_source=ads&token=a=b&debug#top';

    it.each([
        ['url:contains:utm_source=ads', PASS],
        ['url:contains:utm_source=mail', FAIL],
        ['url:path:/post', PASS],
        ['url:path:/about', FAIL],
        ['url:pathStartsWith:/blog', PASS],
        ['url:pathStartsWith:/post', FAIL],
        ['url:pathEndsWith:.html', PASS],
        ['url:pathEndsWith:/blog', FAIL],
        ['url:query:utm_source=ads', PASS],
        ['url:query:utm_source=mail', FAIL],
        ['url:query:debug', PASS],
        ['url:query:missing', FAIL],
        ['url:query:token=a=b', PASS],
        ['url:hostname:example.com', PASS],
        ['url:hostname:other.com', FAIL],
        ['url:matches:utm_source=(ads|mail)', PASS],
        ['url:matches:^http://', FAIL],
        ['url:matches:[', FAIL],
        ['url:pathMatches:^/blog/post-\\d+', PASS],
        ['url:pathMatches:^/news', FAIL],
        ['url:pathMatches:(', FAIL],
        ['url::anything', FAIL],
        ['url:unknown:x', FAIL],
    ])('%s', (opt, expected) => {
        withUrl(URL);
        expect(resolveCondition(urlCondition, opt)).toBe(expected);
    });

    it('fails a query condition when there is no query string at all', () => {
        withUrl('https://example.com/');
        expect(resolveCondition(urlCondition, 'url:query:debug')).toBe(FAIL);
    });
});

describe('user agent condition', () => {
    it.each([
        ['ua:device:mobile', 'iphone', PASS],
        ['ua:device:mobile', 'androidPhone', PASS],
        ['ua:device:mobile', 'ipad', FAIL],
        ['ua:device:mobile', 'androidTablet', FAIL],
        ['ua:device:mobile', 'winChrome', FAIL],
        ['ua:device:tablet', 'ipad', PASS],
        ['ua:device:tablet', 'androidTablet', PASS],
        ['ua:device:tablet', 'iphone', FAIL],
        ['ua:device:desktop', 'macSafari', PASS],
        ['ua:device:desktop', 'winChrome', PASS],
        ['ua:device:desktop', 'iphone', FAIL],
        ['ua:device:watch', 'iphone', FAIL],

        ['ua:browser:safari', 'macSafari', PASS],
        ['ua:browser:safari', 'iphone', PASS],
        ['ua:browser:safari', 'winChrome', FAIL],
        ['ua:browser:chrome', 'winChrome', PASS],
        ['ua:browser:chrome', 'winEdge', FAIL],
        ['ua:browser:chrome', 'opera', FAIL],
        ['ua:browser:edge', 'winEdge', PASS],
        ['ua:browser:opera', 'opera', PASS],
        ['ua:browser:firefox', 'linuxFirefox', PASS],
        ['ua:browser:firefox', 'winChrome', FAIL],
        ['ua:browser:netscape', 'winChrome', FAIL],

        ['ua:os:ios', 'iphone', PASS],
        ['ua:os:ios', 'ipad', PASS],
        ['ua:os:ios', 'macSafari', FAIL],
        ['ua:os:mac', 'macSafari', PASS],
        ['ua:os:mac', 'iphone', FAIL],
        ['ua:os:windows', 'winChrome', PASS],
        ['ua:os:windows', 'macSafari', FAIL],
        ['ua:os:android', 'androidPhone', PASS],
        ['ua:os:linux', 'linuxFirefox', PASS],
        ['ua:os:linux', 'androidPhone', FAIL],
        ['ua:os:chromeos', 'chromeos', PASS],
        ['ua:platform:windows', 'winChrome', PASS],
        ['ua:os:beos', 'winChrome', FAIL],

        ['ua:contains:firefox', 'linuxFirefox', PASS],
        ['ua:contains:Firefox', 'winChrome', FAIL],
        ['ua::gecko', 'linuxFirefox', PASS],
        ['ua:is:' + UA.winChrome, 'winChrome', PASS],
        ['ua:equals:Mozilla', 'winChrome', FAIL],
        ['ua:matches:iphone|ipad', 'ipad', PASS],
        ['ua:matches:android', 'iphone', FAIL],
        ['ua:matches:[', 'iphone', FAIL],
        ['userAgent:device:mobile', 'iphone', PASS],
        ['ua:unknown:x', 'iphone', FAIL],
    ])('%s on %s', (opt, agent, expected) => {
        withUserAgent(UA[agent]);
        expect(resolveCondition(userAgentCondition, opt)).toBe(expected);
    });
});
