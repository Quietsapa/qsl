/**
 * Media query condition handler
 * @param {*} QSL 
 */
export function mediaQueryCondition(QSL) {
    QSL.conditionHandlers.add(function(opt) {
        if (typeof opt !== 'string' || !opt.startsWith('media:')) {
            return null;
        }
        return !window.matchMedia(opt.slice('media:'.length)).matches;
    });
}

/**
 * Language condition handler
 * @param {*} QSL 
 */
export function languageCondition(QSL) {
    QSL.conditionHandlers.add(function(opt) {
        if (typeof opt !== 'string' || !opt.startsWith('lang:')) {
            return null;
        }
        const p = opt.split(':');
        const t = p[1] || 'equals';
        const v = p.slice(2).join(':');
        const l = navigator.language || navigator.languages?.[0] || '';
        
        switch (t) {
            case 'equals':
            case 'is':
                return l !== v;
            case 'contains':
                return !l.includes(v);
            case 'startsWith':
                return !l.startsWith(v);
            case 'in':
                const ls = v.split(',').map(ll => ll.trim());
                return !ls.includes(l);
            default:
                return true; // Unknown type, fail condition
        }
    });
}

/**
 * Timezone condition handler
 * @param {*} QSL 
 */
export function timezoneCondition(QSL) {
    QSL.conditionHandlers.add(function(opt) {
        if (typeof opt !== 'string' || 
            (!opt.startsWith('tz:') && !opt.startsWith('timezone:'))) {
            return null;
        }
        const p = opt.split(':');
        const t = p[1] || 'equals';
        const v = p.slice(2).join(':');
        
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const o = -new Date().getTimezoneOffset() / 60;
            
            switch (t) {
                case 'equals':
                case 'is':
                    return tz !== v;
                case 'contains':
                    return !tz.includes(v);
                case 'offset':
                    return o !== parseInt(v);
                default:
                    return true;
            }
        } catch (e) {
            return true;
        }
    });
}

/**
 * URL condition handler
 * @param {*} QSL 
 */
export function urlCondition(QSL) {
    QSL.conditionHandlers.add(function(opt) {
        if (typeof opt !== 'string' || !opt.startsWith('url:')) {
            return null;
        }
        const lc = window.location;
        const hf = lc.href;
        const pn = lc.pathname;
        const se = lc.search;
        const hn = lc.hostname;
        
        const p = opt.split(':');
        const t = p[1];
        const v = p.slice(2).join(':');
        
        if (!t) return true;
        
        switch (t) {
            case 'contains':
                return !hf.includes(v);
            case 'path':
                return !pn.includes(v);
            case 'pathStartsWith':
                return !pn.startsWith(v);
            case 'pathEndsWith':
                return !pn.endsWith(v);
            case 'query':
                if (se) {
                    const q = new URLSearchParams(se);
                    if (v.includes('=')) {
                        const [key, val] = v.split('=');
                        return q.get(key) !== val;
                    } else {
                        return !q.has(v);
                    }
                } else {
                    return true;
                }
            case 'hostname':
                return !hn.includes(v);
            case 'matches':
                try {
                    return !(new RegExp(v)).test(hf);
                } catch (e) {
                    return true;
                }
            case 'pathMatches':
                try {
                    return !(new RegExp(v)).test(pn);
                } catch (e) {
                    return true; // Error parsing regex, fail condition
                }
            default:
                return true;
        }
    });
}

/**
 * User agent condition handler
 * @param {*} QSL 
 */
export function userAgentCondition(QSL) {
    QSL.conditionHandlers.add(function(opt) {
        if (typeof opt !== 'string' || 
            (!opt.startsWith('ua:') && !opt.startsWith('userAgent:'))) {
            return null;
        }
        const p = opt.split(':');
        const t = p[1] || 'contains';
        const v = p.slice(2).join(':');
        const ua = navigator.userAgent || '';
        const uaLower = ua.toLowerCase();
        const vLower = v.toLowerCase();

        switch (t) {
            case 'contains':
                if (!uaLower.includes(vLower)) return true;
                break;
                
            case 'equals':
            case 'is':
                if (ua !== v) return true;
                break;
                
            case 'matches':
                // Regex pattern matching
                try {
                    if (!(new RegExp(v, 'i')).test(ua)) return true;
                } catch (e) {
                    return true; // Error parsing regex, fail condition
                }
                break;
                
            case 'browser':
                // Detect browser
                const bMap = {
                    'chrome': /chrome/i.test(ua) && !/edg|opr/i.test(ua),
                    'firefox': /firefox/i.test(ua),
                    'safari': /safari/i.test(ua) && !/chrome|chromium|edg|opr/i.test(ua),
                    'edge': /edg/i.test(ua),
                    'opera': /opr/i.test(ua),
                    'ie': /msie|trident/i.test(ua),
                    'chromium': /chromium/i.test(ua)
                };
                const bKey = vLower;
                if (!bMap[bKey]) return true;
                break;
                
            case 'device':
                // Detect device type
                const isM = /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua);
                const isT = /tablet|ipad|playbook|silk/i.test(ua) || (isM && /android/i.test(ua) && !/mobile/i.test(ua));
                const isD = !isM && !isT;
                
                switch (vLower) {
                    case 'mobile': if (!isM) return true; break;
                    case 'tablet': if (!isT) return true; break;
                    case 'desktop': if (!isD) return true; break;
                    default: return true;
                }
                break;
                
            case 'os':
            case 'platform':
                // Detect operating system
                const oMap = {
                    'windows': /win/i.test(ua),
                    'mac': /mac/i.test(ua),
                    'ios': /iphone|ipad|ipod/i.test(ua),
                    'android': /android/i.test(ua),
                    'linux': /linux/i.test(ua) && !/android/i.test(ua),
                    'unix': /unix/i.test(ua),
                    'chromeos': /cros/i.test(ua)
                };
                if (!oMap[vLower]) return true;
                break;
                
            default:
                return true;
        }
        
        // If we reach here, condition passed (none of the cases returned true)
        return false;
    });
}

export default function(QSL) {
    // Media query handler
    mediaQueryCondition(QSL);
    
    // Language handler
    languageCondition(QSL);
    
    // Timezone handler
    timezoneCondition(QSL);
    
    // URL handler
    urlCondition(QSL);
    
    // User agent handler
    userAgentCondition(QSL);
}
