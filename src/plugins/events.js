/**
 * Track events when a process completes.
 * @param {*} QSL 
 */
export default function(QSL) {
    const customEvents = new Map();
    const processElementMap = new WeakMap();
    let documentListener = null;
    let windowListener = null;
    let isIntercepting = false;

    /**
     * Normalize script URL for comparison (remove protocol, domain, query params, hash).
     * @param {string} url - Script URL or path
     * @returns {string} - Normalized path
     */
    const normalizeScriptPath = (u) => {
        if (!u) return '';
        try {
            return u.includes('://') ? new URL(u).pathname : u.split('?')[0].split('#')[0];
        } catch (e) {
            return u.split('?')[0].split('#')[0];
        }
    };

    /**
     * Initialize event interception when QSL loads.
     */
    QSL.loadActions.add(function() {
        if (isIntercepting) return;
        
        documentListener = document.addEventListener;
        windowListener = window.addEventListener;
        isIntercepting = true;

        const iterator = (type, eventType, changeEventName) => {
            let currentScriptId = null;
            let targetFlowId = null;
            
            /**
             * Priority 1: Check document.currentScript for current process ID and flow ID.
             */
            if (document.currentScript) {
                const processElement = processElementMap.get(document.currentScript);
                if (processElement) {
                    currentScriptId = processElement.processId;
                    targetFlowId = processElement.flowId;
                }
            }
            
            /**
             * Priority 2: Check currentProcessPerFlow map for current process ID and flow ID.
             */
            if (!currentScriptId && this.currentProcessPerFlow.size) {
                for (const [flowId, processId] of this.currentProcessPerFlow) {
                    if (processId) {
                        currentScriptId = processId;
                        targetFlowId = flowId;
                        break;
                    }
                }
            }
            
            /**
             * Priority 3: Use Error stack trace only when currentScript is null.
             */
            if (!currentScriptId) {
                const stack = new Error().stack;
                if (stack) {
                    const lines = stack.split('\n');
                    // Skip first 2 lines (Error and iterator function)
                    for (let i = 2; i < lines.length; i++) {
                        const match = lines[i].match(/([^()\s]+\.js(?:\?[^:)]*)?):\d+(?::\d+)?/);
                        if (match) {
                            const file = match[1];
                            const qIndex = file.indexOf('?');
                            const stackFile = qIndex === -1 ? file.trim() : file.slice(0, qIndex).trim();
                            
                            if (stackFile) {
                                // Normalize: remove query/hash, extract pathname from URL
                                const qIdx = stackFile.indexOf('?');
                                const hIdx = stackFile.indexOf('#');
                                const endIdx = qIdx === -1 ? (hIdx === -1 ? stackFile.length : hIdx) : (hIdx === -1 ? qIdx : Math.min(qIdx, hIdx));
                                let normalizedFile = stackFile.slice(0, endIdx);
                                try {
                                    if (normalizedFile.includes('://')) {
                                        normalizedFile = new URL(normalizedFile).pathname;
                                    }
                                } catch (e) {}
                                const lastSlash = normalizedFile.lastIndexOf('/');
                                const fileName = lastSlash === -1 ? normalizedFile : normalizedFile.slice(lastSlash + 1);
                                
                                for (const [flowId, processes] of this.flows) {
                                    for (const process of processes) {
                                        if (process.src && process.type === 'script') {
                                            const normalizedSrc = normalizeScriptPath(process.src);
                                            const srcLastSlash = normalizedSrc.lastIndexOf('/');
                                            const srcFileName = srcLastSlash === -1 ? normalizedSrc : normalizedSrc.slice(srcLastSlash + 1);
                                            
                                            if (normalizedFile === normalizedSrc || (fileName && fileName === srcFileName)) {
                                                currentScriptId = process.id;
                                                targetFlowId = flowId;
                                                break;
                                            }
                                        }
                                    }
                                    if (currentScriptId) break;
                                }
                                if (currentScriptId) break;
                            }
                        }
                    }
                }
            }
            
            /**
             * If current script ID and flow ID are found, track event.
             * Only change event name if event already fired (changeEventName = true).
             */
            if (currentScriptId && targetFlowId) {
                const flow = this.flows.get(targetFlowId);
                const process = flow?.find(p => p.id === currentScriptId || p.id === this.PREFIX + currentScriptId);
                
                if (process) {
                    const shouldFireEvents = process.fireEvents !== false && (this.flowOptions.get(targetFlowId)?.fireEvents !== false);
                    if (shouldFireEvents) {
                        const eventName = `${type}:${process.id}`;
                        if (!customEvents.has(process.id)) customEvents.set(process.id, []);
                        const events = customEvents.get(process.id);
                        if (!events.some(e => e.name === eventName)) events.push({ type: eventType, name: eventName });
                        if (changeEventName) type = eventName;
                    }
                }
            }
            return type;
        };

        document.addEventListener = (type, listener, opts) => {
            if (type === 'DOMContentLoaded' && this.LIFECYCLE.DOMREADY) {
                /**
                 * Only rename here. The renamed event is dispatched once, when
                 * the process completes (see processCompleteActions below).
                 * Dispatching here as well would deliver it twice, and a vendor
                 * that registers two listeners would see every one of them fire
                 * once per registration on top of that.
                 */
                type = iterator.call(this, type, this.EVENTS.DOMREADY, true);
            }
            return documentListener.call(document, type, listener, opts);
        };

        window.addEventListener = (type, listener, opts) => {
            if (type === 'load' && this.LIFECYCLE.LOADED) {
                /* Same as above: rename now, dispatch once on completion. */
                type = iterator.call(this, type, this.EVENTS.LOADED, true);
            }
            return windowListener.call(window, type, listener, opts);
        };
    });

    /**
     * Provide handler callbacks for process execution.
     * Register process elements in processElementMap.
     */
    QSL.handlerCallbacksFilters.add(function(process) {
        return {
            registerProcessElement: (el, config) => {
                processElementMap.set(el, { flowId: config.flowId, processId: config.id });
            }
        };
    });

    /**
     * Fire tracked events when a process completes.
     * Use processCompleteActions instead of patching execute.
     */
    QSL.processCompleteActions.add(function(process) {
        const events = customEvents.get(process.id);
        if (events && Array.isArray(events)) {
            for (const event of events) {
                if (event.type === this.EVENTS.DOMREADY) {
                    if (this.LIFECYCLE.DOMREADY) {
                        document.dispatchEvent(new Event(event.name));
                    } else {
                        document.addEventListener('DOMContentLoaded', () => {
                            document.dispatchEvent(new Event(event.name));
                        }, { once: true });
                    }
                } else if (event.type === this.EVENTS.LOADED) {
                    if (this.LIFECYCLE.LOADED) {
                        window.dispatchEvent(new Event(event.name));
                    } else {
                        window.addEventListener('load', () => {
                            window.dispatchEvent(new Event(event.name));
                        }, { once: true });
                    }
                }
            }
        }
    });

    /**
     * Cleanup: restore original addEventListener functions on reset.
     * Use resetActions instead of patching reset.
     */
    QSL.resetActions.add(function() {
        if (isIntercepting && documentListener && windowListener) {
            document.addEventListener = documentListener;
            window.addEventListener = windowListener;
            isIntercepting = false;
        }
    });

    /**
     * Store custom events map.
     */
    QSL.customEvents = customEvents;
}
