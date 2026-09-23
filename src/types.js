/**
 * Get cache-bypass suffix for a URL.
 */
const bypassSuffix = (source, bypassCache) =>{
    return bypassCache ? ( ( source.includes('?') ? '&' : '?') + Date.now() ) : '';
}

/**
 * Trusted Types. On a page whose CSP says `require-trusted-types-for
 * 'script'`, the browser refuses plain strings for a script's code and URL
 * and for innerHTML. QSL hands them over through its own policy, named
 * `qsl`, which the page has to allow (`trusted-types qsl`).
 *
 * The policy passes values through unchanged. QSL does not sanitise: its
 * configuration is code, written by the site, and must never contain data a
 * visitor controls. Allowing `qsl` in the CSP is the site saying it trusts
 * that configuration. Without Trusted Types in the browser, or without the
 * policy allowed, strings are used as they are, and on an enforcing page the
 * browser's refusal fails the process.
 */
let policy;
const trusted = (kind, value) => {
    if (policy === undefined) {
        policy = null;
        try {
            const pass = (v) => v;
            policy = window.trustedTypes?.createPolicy('qsl', { createHTML: pass, createScript: pass, createScriptURL: pass }) || null;
        } catch (e) {
            /**
             * Not allowed by the page's CSP: stay with strings.
             */
        }
    }
    return policy ? policy[kind](value) : value;
}

/**
 * Resolve the process, then run its onComplete. An onComplete that throws is
 * rethrown on its own tick: it shows up as an uncaught error, but it cannot
 * leave the process unsettled or be mistaken for a load failure.
 */
const complete = (resolve, onComplete) => {
    resolve?.();
    try {
        onComplete?.();
    } catch (e) {
        setTimeout(() => { throw e; });
    }
}

/**
 * Complete a process as soon as its element is inserted, for elements that
 * load nothing: inline code, styles, markup.
 */
const inserted = ({ config, resolve }) => complete(resolve, config.onComplete);

/**
 * Render an element.
 *
 * The process's `delay` and `onBeforeStart` are the core's to apply, once,
 * before the first attempt; `prepare` is for a type's own groundwork.
 */
const render = (config, callbacks = {}) => {
    return new Promise(async (resolve, reject) => {
        const { flowId, tag, id, data, prepare, onComplete, onError, footer, dom, onElement, onCustomResolve } = config;
        if (!flowId || !id) {
            resolve();
            return;
        }
        try {
            if (!tag) throw new Error(`The ${config.type} type needs a tag`);
            if (prepare) await prepare(config);
            let el = document.createElement(tag);
            onElement?.(el, config);

            callbacks.registerProcessElement?.(el, config);

            if (data && typeof data === 'object') {
                for (const [key, value] of Object.entries(data)) {
                    el.setAttribute(`data-${key.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^-/, '')}`, String(value));
                }
            }

            if (!onCustomResolve) {
                el.onload = () => {
                    complete(resolve, onComplete);
                };
            }
            el.onerror = (e) => {
                /**
                 * Another attempt follows: take the failed element out so
                 * that the page does not collect them.
                 */
                if (callbacks.retrying) el.remove();
                onError?.(e);
                reject(e);
            };
            if (dom) {
                (footer ? document.body : document.head).appendChild(el);
            }
            onCustomResolve?.({ el, config, resolve, reject });
        } catch (e) {
            onError?.(e);
            reject(e);
        }
    });
}

/**
 * Render an inline script.
 */
const InlineScript = {
    type: 'inline-script',
    handler: (config, callbacks) => {
        return render({
            ...config,
            code: config.code?.replace(/<script.*?>|<\/script>/gi, ''),
            tag: 'script',
            dom: true,
            onElement: (el, { code, module }) => {
                if (module) el.type = 'module';
                if (code) el.textContent = trusted('createScript', code);
            },
            /**
             * A classic inline script has run by then, synchronously. A
             * module runs later, on its own schedule, and reports nothing
             * when it has: QSL does not wait for it.
             */
            onCustomResolve: inserted
        }, callbacks);
    }
};

/**
 * Render a script element.
 */
const Script = {
    type: 'script',
    handler: (config, callbacks) => {     
        return render({
            ...config,
            tag: 'script',
            dom: true,
            onElement: (el, { src, module, async, defer, crossOrigin, integrity, fetchPriority, bypassCache }) => {
                if (module) el.type = 'module';
                if (fetchPriority) el.setAttribute('fetchpriority', fetchPriority);
                if (async) el.async = async;
                if (defer) el.defer = defer;
                if (crossOrigin) el.crossOrigin = crossOrigin;
                if (integrity) el.integrity = integrity;
                if (src) el.src = trusted('createScriptURL', src + bypassSuffix(src, bypassCache));
            }
        }, callbacks);
    }
};

/**
 * Render an inline style.
 */
const InlineStyle = {
    type: 'style',
    handler: (config, callbacks) => {
        const normalizedConfig = {
            ...config,
            code: config.code?.replace(/<style.*?>|<\/style>/gi, '')
        };
        return render({
            ...normalizedConfig,
            tag: 'style',
            dom: true,
            onElement: (el, { code }) => {
                if (code) el.textContent = code;
            },
            onCustomResolve: inserted
        }, callbacks);
    }
};

/**
 * Render a stylesheet.
 */
const Stylesheet = {
    type: 'stylesheet',
    handler: (config, callbacks) => {
        return render({
            ...config,
            tag: 'link',
            dom: true,
            onElement: (el, { href, crossOrigin, fetchPriority, bypassCache }) => {
                el.rel = 'stylesheet';
                if (fetchPriority) el.setAttribute('fetchpriority', fetchPriority);
                if (crossOrigin) el.crossOrigin = crossOrigin;
                el.href = href + bypassSuffix(href, bypassCache);
            }
        }, callbacks);
    }
};

/**
 * Render a pixel.
 */
const Pixel = {
    type: 'pixel',
    handler: (config, callbacks) => {
        return render({
            ...config,
            tag: 'img',
            /**
             * In the document by default. With `dom: false` the image is
             * never inserted: a detached <img> still makes the request and
             * still reports load or error.
             */
            dom: config.dom !== false,
            onElement: (el, { style = { display: 'none' }, src, fetchPriority, bypassCache }) => {
                if (fetchPriority) el.setAttribute('fetchpriority', fetchPriority);
                el.src = src + bypassSuffix(src, bypassCache);
                el.width = 1;
                el.height = 1;
                if ( style && typeof style === 'object' ) {
                    for (const [key, value] of Object.entries(style)) {
                        el.style.setProperty(key, value);
                    }
                }
            }
        }, callbacks);
    }
};

/**
 * Render a custom element.
 */
const Shadow = {
    type: 'shadow',
    handler: (config, callbacks) => {
        return render({
            ...config,
            prepare: ({ tag }) => window.customElements.whenDefined(tag),
            onElement: (el, { shadowData }) => {
                el.data = shadowData || {};
                if (shadowData?.hidden) el.setAttribute('hidden', '');    
            },
            onCustomResolve: ({ el, config, resolve, reject }) => {
                const { shadowData, onComplete, onError } = config;
                const resolver = () => {
                    const selector = shadowData?.container;
                    let container = null;
                    if (selector === 'body') {
                        container = document.body;
                    } else if (typeof selector === 'string' && selector) {
                        try {
                            container = document.querySelector(selector);
                        } catch (e) {
                            container = null;
                        }
                    }
                    if (!container) {
                        const err = new Error(`Container not found: ${selector}`);
                        onError?.(err);
                        reject(err);
                        return;
                    }
                    shadowData?.position === 'top' ? container.insertBefore(el, container.firstChild) : container.appendChild(el);
                    complete(resolve, onComplete);
                };
                if (document.readyState === 'interactive' || document.readyState === 'complete') {
                    resolver();
                } else {
                    document.addEventListener('DOMContentLoaded', resolver, { once: true });
                }
            }
        }, callbacks);
    }
}

/**
 * Render an HTML element.
 */
const HTML = {
    type: 'html',
    handler: (config, callbacks) => {
        return render({
            ...config,
            dom: true,
            onElement: (el, { html = '', id = '', className = '', style = {} }) => {
                /**
                 * Markup from the configuration, which the site wrote; see
                 * `trusted` above.
                 */
                if (html) el.innerHTML = trusted('createHTML', html);
                if (id) el.id = id;
                if (className) el.className = Array.isArray(className) ? className.join(' ') : className;
                if ( style && typeof style === 'object' ) {
                    for (const [key, value] of Object.entries(style)) {
                        el.style.setProperty(key, value);
                    }
                }
            },
            onCustomResolve: inserted
        }, callbacks);
    }
};

/**
 * Default types for QSL.
 */
export { Script, Stylesheet, InlineScript, InlineStyle, Pixel, Shadow, HTML };