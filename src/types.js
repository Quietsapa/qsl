/**
 * Get cache-bypass suffix for a URL.
 */
const bypassSuffix = (source, bypassCache) =>{
    return bypassCache ? ( ( source.includes('?') ? '&' : '?') + Date.now() ) : '';
}

/**
 * Log a message.
 */
const log = (detail) => {
    window.dispatchEvent(new CustomEvent('QSL:log', { detail }));
}

/**
 * Log an error.
 */
const error = (detail) => {
    window.dispatchEvent(new CustomEvent('QSL:error', { detail }));
}

/**
 * Render an element.
 */
const render = (config, callbacks = {}) => {
    return new Promise(async (resolve) => {
        const { flowId, tag, id, delay, data, onBeforeStart, onComplete, onError, footer, dom, onElement, onCustomResolve } = config;
        if (!flowId || !tag || !id) {
            resolve();
            return;
        }
        try {
            if (onBeforeStart) await onBeforeStart(config);
            log({ tag, type: 'PROCESS_STARTED', config });
            if (delay) await new Promise(res => setTimeout(res, delay));
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
                    log({ tag, type: 'PROCESS_COMPLETED', config });
                    onComplete?.();
                    resolve();
                };
            }
            el.onerror = (e) => {
                error({ tag, type: 'PROCESS_FAILED', config });
                onError?.(e);
                resolve(e);
            };
            if (dom) {
                (footer ? document.body : document.head).appendChild(el);
            }
            onCustomResolve?.({ el, config, resolve });
        } catch (e) {
            error({ tag, type: 'PROCESS_FAILED', config, error: e });
            onError?.(e);
            resolve(e);
        }
    });
}

/**
 * Render an inline script.
 */
const InlineScript = {
    type: 'inline-script',
    handler: (config, callbacks) => {      
        let storedResolve = null;
        let alreadyFired = false;
        const eventName = `QSL:inline-script:completed:${config.id}`;
        const resolveProcess = () => {
            log({ tag: 'inline-script', type: 'INLINE_SCRIPT_SUCCESS', config });
            log({ tag: 'inline-script', type: 'PROCESS_COMPLETED', config });
            config?.onComplete?.();
            storedResolve?.();
        };
        const normalizedConfig = {
            ...config,
            code: config.code?.replace(/<script.*?>|<\/script>/gi, '')
        };
        return render({
            ...normalizedConfig,
            tag: 'script',
            dom: true,
            onElement: (el, config) => {
                const { code, module, id, flowId } = config;
                if (code) el.textContent = code;
                if (module) {
                    el.type = 'module';
                    const originalCode = el.textContent;
                    const fid = JSON.stringify(String(flowId));
                    const pid = JSON.stringify(String(id));
                    const evt = JSON.stringify(String(eventName));
                    const wrappedCode = `(function(){window.__QSL__.currentProcessPerFlow.set(${fid},${pid});try{${originalCode}}finally{window.__QSL__.currentProcessPerFlow.delete(${fid});window.dispatchEvent(new Event(${evt}));}})();`;
                    el.textContent = wrappedCode;
                    const handler = () => {
                        window.removeEventListener(eventName, handler);
                        if (storedResolve) {
                            resolveProcess();
                        } else { 
                            alreadyFired = true;
                        }
                    };
                    window.addEventListener(eventName, handler);
                }
            },
            onCustomResolve: ({ el, config, resolve }) => {
                const { module } = config;
                storedResolve = resolve;
                if (module && alreadyFired) {
                    resolveProcess();
                } else if (!module) {
                    queueMicrotask(() => {
                        if (storedResolve === resolve) resolveProcess();
                    });
                }
            }
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
            onElement: (el, { src, module, async, defer, crossOrigin, integrity, bypassCache }) => {
                if (module) el.type = 'module';
                if (async) el.async = async;
                if (defer) el.defer = defer;
                if (crossOrigin) el.crossOrigin = crossOrigin;
                if (integrity) el.integrity = integrity;
                if (src) el.src = src + bypassSuffix(src, bypassCache);
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
            onCustomResolve: ({ el, config, resolve }) => {
                const { tag, onComplete } = config;
                log({ tag, type: 'INLINE_STYLE_SUCCESS', config });
                log({ tag, type: 'PROCESS_COMPLETED', config });
                onComplete?.();
                resolve();
            }
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
            onElement: (el, { href, crossOrigin, bypassCache }) => {
                el.rel = 'stylesheet';
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
            dom: true,
            onElement: (el, { style = { display: 'none' }, dom, src, bypassCache }) => {
                if ( ! dom ) el = new window.Image();
                el.src = src + bypassSuffix(src, bypassCache);
                el.width = 1;
                el.height = 1;
                if ( style && typeof style === 'object' ) {
                    for (const [key, value] of Object.entries(style)) {
                        el.style.setProperty(key, value);
                    }
                }
            },
            onCustomResolve: ({ el, config, resolve }) => {
                const { tag, dom, onComplete } = config;
                const resolver = () => {
                    log({ tag, type: 'IMAGE_LOADED', config });
                    log({ tag, type: 'PROCESS_COMPLETED', config });
                    onComplete?.();
                    resolve();
                };
                ! dom ? resolver() : el.onload = () => resolver();
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
            onBeforeStart: async ({ tag }) => await window.customElements.whenDefined(tag),
            onElement: (el, { shadowData }) => {
                el.data = shadowData || {};
                if (shadowData?.hidden) el.setAttribute('hidden', '');    
            },
            onCustomResolve: ({ el, config, resolve }) => {
                const { tag, shadowData, onComplete, onError } = config;
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
                        error({ tag, type: 'SHADOW_FAILED', config, error: err });
                        onError?.(err);
                        resolve(err);
                        return;
                    }
                    shadowData?.position === 'top' ? container.insertBefore(el, container.firstChild) : container.appendChild(el);
                    log({ tag, type: 'SHADOW_SUCCESS', config });
                    log({ tag, type: 'PROCESS_COMPLETED', config });
                    onComplete?.();
                    resolve();
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
                if (html) el.innerHTML = html;
                if (id) el.id = id;
                if (className) el.className = Array.isArray(className) ? className.join(' ') : className;
                if ( style && typeof style === 'object' ) {
                    for (const [key, value] of Object.entries(style)) {
                        el.style.setProperty(key, value);
                    }
                }
            },
            onCustomResolve: ({ el, config, resolve }) => {
                const { tag, onComplete } = config;
                log({ tag, type: 'HTML_SUCCESS', config });
                log({ tag, type: 'PROCESS_COMPLETED', config });
                onComplete?.();
                resolve();
            }
        }, callbacks);
    }
};

/**
 * Default types for QSL.
 */
export { Script, Stylesheet, InlineScript, InlineStyle, Pixel, Shadow, HTML };