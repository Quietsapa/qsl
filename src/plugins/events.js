/**
 * Track events when a process completes.
 * @param {*} QSL 
 */
export default function(QSL) {
    const customEvents = new Map();
    const processElementMap = new WeakMap();
    let processCounter = 0;

    /**
     * Whether our lifecycle logic runs. The wrappers can outlive a run (see createPatch), so this flag — not their presence — is what switches the interception on and off. 
     */
    let active = false;
    let lifecycleIterator = null;

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
     * A key that is unique to this process OBJECT, not to its id.
     *
     * Ids are not unique: the same explicit id can be used by a process in a
     * later load() cycle, or by a late add that the dynamic plugin puts in its
     * own flow. Keying the private event name on the id alone means the second
     * process dispatches an event the first process's listener is still bound
     * to, and that listener runs again. Every listener from one process shares
     * this key, so one dispatch still serves all of them.
     *
     * @param {Object} process
     * @returns {string}
     */
    const processKey = (process) => {
        if (!process._eventKey) {
            process._eventKey = process.id + '#' + (++processCounter);
        }
        return process._eventKey;
    };

    /**
     * Wrap addEventListener on one target so it can be undone without leaving
     * a trace on the page.
     *
     * Two things matter here, because the scripts QSL loads include APM, RUM
     * and session-replay SDKs that instrument addEventListener themselves:
     *
     *   - Restore the exact previous state. The method normally comes from
     *     EventTarget.prototype; assigning it back would leave an own property
     *     on the target that shadows the prototype forever, and any SDK that
     *     instruments the prototype later would never see this target.
     *   - Never clobber someone else. If another script wrapped on top of us
     *     during the run, we leave their wrapper where it is. Ours stays in the
     *     chain but becomes a plain pass-through while `active` is false, and
     *     is reused if a later run switches it back on.
     *
     * @param {EventTarget} target - document or window
     * @param {Function} wrap - (original) => wrapper
     */
    const createPatch = (target, wrap) => {
        const patch = { original: null, wrapper: null, hadOwn: false };

        patch.apply = () => {
            /**
             * Still installed from an earlier run, on top or stacked under someone else: flipping `active` is all it takes. 
             */
            if (patch.wrapper) return;
            patch.hadOwn = Object.prototype.hasOwnProperty.call(target, 'addEventListener');
            patch.original = target.addEventListener;
            patch.wrapper = wrap(patch.original);
            target.addEventListener = patch.wrapper;
        };

        patch.remove = () => {
            if (!patch.wrapper || target.addEventListener !== patch.wrapper) return;
            if (patch.hadOwn) {
                target.addEventListener = patch.original;
            } else {
                delete target.addEventListener;
            }
            patch.wrapper = null;
            patch.original = null;
        };

        return patch;
    };

    /**
     * A renamed listener is dispatched once, so it is registered with `once`:
     * kept, it would stay on document or window for the life of the page.
     */
    const once = (opts) => (opts && typeof opts === 'object' ? { ...opts, once: true } : { capture: !!opts, once: true });

    /**
     * Regular functions, not arrows: the original is called with whatever receiver the caller used, exactly as the native method would be. 
     */
    const documentPatch = createPatch(document, (original) => function (type, listener, opts) {
        if (active && type === 'DOMContentLoaded' && QSL.LIFECYCLE.DOMREADY) {
            /**
             * Only rename here. The renamed event is dispatched once, when
             * the process settles (see the PROCESS_* listener below).
             * Dispatching here as well would deliver it twice, and a vendor
             * that registers two listeners would see every one of them fire
             * once per registration on top of that.
             */
            const renamed = lifecycleIterator(type, QSL.EVENTS.DOMREADY, true);
            if (renamed !== type) {
                type = renamed;
                opts = once(opts);
            }
        }
        return original.call(this, type, listener, opts);
    });

    const windowPatch = createPatch(window, (original) => function (type, listener, opts) {
        if (active && type === 'load' && QSL.LIFECYCLE.LOADED) {
            // Same as above: rename now, dispatch once on completion.
            const renamed = lifecycleIterator(type, QSL.EVENTS.LOADED, true);
            if (renamed !== type) {
                type = renamed;
                opts = once(opts);
            }
        }
        return original.call(this, type, listener, opts);
    });

    /**
     * Initialize event interception when QSL loads.
     */
    QSL.listeners.add(function({ type }) {
        if (type !== 'LOAD' || active) return;

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
             * Priority 2: Use Error stack trace only when currentScript is null.
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
                                
                                for (const [flowId, flow] of this.flows) {
                                    for (const process of flow.processes) {
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
                const process = flow?.processes.find(p => p.id === currentScriptId || p.id === this.PREFIX + currentScriptId);
                
                if (process) {
                    const shouldFireEvents = process.fireEvents !== false && (flow.options.fireEvents !== false);
                    if (shouldFireEvents) {
                        const key = processKey(process);
                        const eventName = `${type}:${key}`;
                        if (!customEvents.has(key)) customEvents.set(key, []);
                        const events = customEvents.get(key);
                        if (!events.some(e => e.name === eventName)) events.push({ type: eventType, name: eventName });
                        if (changeEventName) type = eventName;
                    }
                }
            }
            return type;
        };

        lifecycleIterator = iterator;
        documentPatch.apply();
        windowPatch.apply();
        active = true;
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
     * Fire tracked events when a process settles.
     */
    QSL.listeners.add(function({ type, process }) {
        if (type !== 'PROCESS_COMPLETED' && type !== 'PROCESS_FAILED' && type !== 'PROCESS_SKIPPED') return;
        const events = customEvents.get(process._eventKey);
        customEvents.delete(process._eventKey);
        if (events && Array.isArray(events)) {
            /**
             * An event is only recorded once the real one has already fired
             * (see the patched addEventListener), so it can be dispatched now.
             */
            for (const event of events) {
                const target = event.type === this.EVENTS.DOMREADY ? document : window;
                target.dispatchEvent(new Event(event.name));
            }
        }
    });

    /**
     * Cleanup on reset: drop what the run recorded (a process cut short never
     * settles) and restore the original addEventListener functions.
     */
    QSL.listeners.add(function({ type }) {
        if (type !== 'RESET') return;
        customEvents.clear();
        if (!active) return;
        active = false;
        documentPatch.remove();
        windowPatch.remove();
    });

    /**
     * Store custom events map.
     */
    QSL._customEvents = customEvents;
}
