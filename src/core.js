export default {
    /**
     * Constants
     */
    VERSION: '0.1.3',
    PREFIX: 'qsl-',
    FLOW_TYPE: {
        DEFAULT: 'default',
        ORDERED: 'ordered',
    },
    FLOW_STATE: {  
        READY: 'READY',
        RUNNING: 'RUNNING',
        COMPLETED: 'COMPLETED'
    },
    FLOW_OPTIONS: {
        delay: 0,
        priority: 0,
        between: null,
        trigger: null,
        condition: null,
        beforeStart: null,
        onComplete: null,
        group: null,
        paused: false,
        preload: false,
        fireEvents: true,
        depends: []
    },
    EVENTS: {
        STARTED: 'QSL:started',
        COMPLETED: 'QSL:completed',
        ERROR: 'QSL:error',
        FLOW_STARTED: 'QSL:flow:started',
        FLOW_COMPLETED: 'QSL:flow:completed',
        ALL_COMPLETED: 'QSL:all:completed',
        SKIPPED: 'QSL:skipped',
        DOMREADY: 'QSL:domready',
        LOADED: 'QSL:loaded',
    },
    LIFECYCLE: {
        DOMREADY: document.readyState === 'interactive' || document.readyState === 'complete',
        LOADED: false,
    },
    CALLBACK: 'QSLReady',
    /**
     * Properties
     */
    types: new Map(), // Map to store custom resource types
    flows: new Map(), // Map to store flows
    flowOptions: new Map(), // Map to store flow options
    flowGroups: new Map(), // Map to store flow groups
    currentProcessPerFlow: new Map(), // Map to store current process per flow (flowId -> processId)

    pendingFlows: new Set(), // Set to store pending flows
    pendingProcesses: new Set(), // Set to store pending processes
    completedProcesses: new Set(), // Set to store completed processes
    loadActions: new Set(), // Set to store before load triggers
    initActions: new Set(), // Set to store init triggers
    addProcessFilters: new Set(), // Set to store add triggers
    completedFlowsActions: new Set(), // Set to store completed flows actions
    flowIdFilters: new Set(), // Set to store flowId filters
    conditionHandlers: new Set(), // Set to store condition handlers
    triggerHandlers: new Set(), // Set to store trigger handlers
    processCompleteActions: new Set(), // Set to store process completion actions
    allCompleteActions: new Set(), // Set to store all flows completion actions
    resetActions: new Set(), // Set to store reset actions
    handlerCallbacksFilters: new Set(), // Set to store handler callbacks filters

    onAllComplete: null, // Callback for all flows completion
    globalResolve: null, // Global resolve function
    logger: null, // Logger instance

    hasStarted: false, // Flag to check if QSL has started,
    eventsEnabled: false, // Flag to check if events are enabled
    initialized: false, // Flag to check if QSL is initialized
    completing: false, // Flag to check if QSL is completing
    autoReset: true, // Whether reset() runs automatically once every flow completes

    globalBetween: 0, // Global delay between processes

    /**
     * Initialize the QSL library.
     * @returns {Promise<this>}
     */
    async init() {
        if (this.initialized) return this;

        const loaderScript = document.currentScript;

        /* Check if QSL is already initialized */
        window.__QSL__ = window.__QSL__ || this;

        /* Check DOMContentLoaded state */
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            this.LIFECYCLE.DOMREADY = true;
        } else {
            document.addEventListener('DOMContentLoaded', () => this.LIFECYCLE.DOMREADY = true, { once: true });
        }

        /* Check window load state */
        if (document.readyState === 'complete') {
            this.LIFECYCLE.LOADED = true;
        } else {
            window.addEventListener('load', () => this.LIFECYCLE.LOADED = true, { once: true });
        }

        /* Register default type: console */
        this.registerType('console', (process) => {
            return new Promise((resolve) => {
                process.onBeforeStart?.();
                setTimeout(() => {
                    if ( process.message ) this.log( process.message, { timestamp: Date.now() } );
                    process.onComplete?.();
                    resolve();
                }, process.delay || 0);
            });
        });

        /**
         * Custom event listeners for logging and error handling
         */
        window.addEventListener('QSL:log', (e) => this.log(e.detail.type, e.detail.config.id));
        window.addEventListener('QSL:error', (e) => this.error(e.detail.type, e.detail.error, e.detail.config.id));

        /**
         * Load init triggers
         */
        if ( this.initActions.size ) {
            for ( const cb of this.initActions ) {
                if ( typeof cb === 'function' ) await cb.call(this);
            }
        }
        
        this.initialized = true;

        /**
         * Check if async loading is enabled
         */
        const url = loaderScript && loaderScript.src ? new URL(loaderScript.src, document.baseURI) : null;
        if (!url || url.searchParams.get('async') !== 'true') return this;

        /**
         * Callback on async loading with default callback name
         */
        const callback = url.searchParams.get('callback') || this.CALLBACK;
        if (typeof window[callback] === 'function') window[callback]();

        /**
         * Return QSL instance for chaining
         */
        return this;
        
    },
    
    /**
     * Register a plugin to QSL.
     *
     * @param {Function} plugin - The plugin function to register.
     * @param {...any} args - Additional arguments passed to the plugin.
     * @returns {this}
     */
    use(plugin, ...args) {
        if (typeof plugin === 'function') plugin(this, ...args);
        return this;
    },

    /**
     * Add a process config to a flow.
     * Handles process-level dependencies separately from flow-level logic.
     *
     * @param {Object} config - The process configuration object.
     * @param {string|boolean|null} [flowId=null] - The flow ID or true for ordered, or null for default.
     * @returns {this}
     */
    add(config, flowId = null) {
        if (!config || typeof config !== 'object') return this;

        /* Generate ID and default to process state */
        config.id = config.id ? this.PREFIX + config.id : this.PREFIX + Math.random().toString(36).slice(2);
        config.skipped = false;

        /* Sanitize config and set default type */
        if (!config.type) config.type = 'console';

        /* Register process-level dependencies */
        if (Array.isArray(config.depends)) config.depends = [...new Set(config.depends)];

        /* Filter flowId and config by addProcessFilters */
        if ( this.addProcessFilters.size ) {
            for ( const cb of this.addProcessFilters ) {
                if ( typeof cb === 'function' ) [flowId, config] = cb.call(this, flowId, config);
            }
        }

        /* Store flowId on process for quick lookup */
        const normalizedFlowId = this.normalizeFlowId(flowId);
        config.flowId = normalizedFlowId;

        /* Add to flow for flow-level execution */
        this.getOrCreateFlow(normalizedFlowId).push(config);

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Start loading all flows.
     *
     * @param {Object} [options={}]
     * @param {number|boolean} [options.between=false] - Global delay between processes.
     * @returns {Promise<this>}
     */
    async load({ between = false } = {}) {
        if (this.hasStarted) return;
        this.hasStarted = true;
        
        /**
         * Set global between
         */
        this.globalBetween = between;

        /**
         * Call load actions
         */
        for ( const cb of this.loadActions ) {
            if (typeof cb === 'function') cb.call(this);
        }

        /**
         * Return global promise
         */
        return new Promise((resolve) => {
            if (!this.flows.size) {
                this.reset();
                return resolve();
            }

            this.globalResolve = resolve;
            this.processFlows();
        });
        
    },

    /**
     * Reset all internal state and clear all flows/options.
     * 
     * @returns {void}
     */
    reset() {
        /**
         * Call reset actions before clearing
         */
        if (this.resetActions.size) {
            for (const action of this.resetActions) {
                if (typeof action === 'function') action.call(this);
            }
        }

        /**
         * Clear run state only. Plugin registrations (types, condition and
         * trigger handlers, lifecycle hooks) survive, so processes added after
         * a completed run still behave the same way. Use destroy() to tear the
         * whole instance down.
         */
        this.flows.clear();
        this.flowOptions.clear();
        this.flowGroups.clear();
        this.pendingFlows.clear();
        this.pendingProcesses.clear();
        this.completedProcesses.clear();
        this.currentProcessPerFlow.clear();
        this.onAllComplete = null;
        this.globalResolve = null;
        this.hasStarted = false;
        this.globalBetween = 0;

        this.log('RESET');

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Tear the instance down completely: run state, plugin registrations and
     * registered types. After this, init() has to run again.
     *
     * @returns {this}
     */
    destroy() {
        this.reset();

        this.types.clear();
        this.initActions.clear();
        this.loadActions.clear();
        this.addProcessFilters.clear();
        this.completedFlowsActions.clear();
        this.flowIdFilters.clear();
        this.conditionHandlers.clear();
        this.triggerHandlers.clear();
        this.processCompleteActions.clear();
        this.allCompleteActions.clear();
        this.resetActions.clear();
        this.handlerCallbacksFilters.clear();

        this.logger = null;
        this.eventsEnabled = false;
        this.initialized = false;

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Set the logger instance.
     *
     * @param {Object|Function} logger - Logger instance or function.
     * @returns {this}
     */
    setLogger(logger) {
        if (logger && ( typeof logger === 'function' || typeof logger === 'object' ) ) this.logger = logger;

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Set a callback to run when all flows/processes are complete.
     *
     * @param {Function} callback - The callback function.
     * @returns {this}
     */
    setOnAllComplete(callback) {
        this.onAllComplete = typeof callback === 'function' ? callback : null;

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Enable DOM events for process/flow lifecycle.
     * @returns {this}
     */
    useEvents() {
        this.eventsEnabled = true;

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Log a message using the custom logger if set.
     *
     * @param {string} type - Log type.
     * @param {...any} args - Additional log arguments.
     */
    log(type, ...args) {
        if (this.logger && typeof this.logger.log === 'function') this.logger.log(type, ...args);
    },

    /**
     * Log an error using the custom logger if set.
     * 
     * @param {string} type - Error type.
     * @param {...any} args - Additional error arguments.
     */
    error(type, ...args) {
        if (this.logger && typeof this.logger.error === 'function') this.logger.error(type, ...args);
    },

    /**
     * Fire a DOM event if events are enabled.
     * 
     * @param {string} event - Event name.
     * @param {Object} detail - Event detail object.
     */
    fire(event, detail) {
        if (this.eventsEnabled && this.EVENTS[event]) {
            window.dispatchEvent(new CustomEvent(this.EVENTS[event], { detail }));
        }
    },

    /**
     * Normalize the flow ID.
     * 
     * @param {string|boolean|null} flowId - The flow ID or true for ordered, or null for default.
     * @returns {string} Normalized flow ID.
     */
    normalizeFlowId(flowId) {
        if (flowId === true) {
            flowId = this.FLOW_TYPE.ORDERED;
        } else if (typeof flowId !== 'string') {
            flowId = this.FLOW_TYPE.DEFAULT;
        }
        return flowId;
    },

    /**
     * Register a custom resource type handler.
     *
     * @param {string} type - Resource type name.
     * @param {Function} handler - Handler function for the type.
     * @returns {this}
     */
    registerType(type, handler) {
        if (typeof type !== 'string' || typeof handler !== 'function') return this;
        this.types.set(type, handler);

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Register multiple custom resource types.
     *
     * @param {Array<{type: string, handler: Function}>|Object} types - Array or object of type definitions.
     * @returns {this}
     */
    registerTypes(types) {
        if (!types || typeof types !== 'object') return this;

        /* Accept both [{ type, handler }] and { name: handler } */
        const list = Array.isArray(types)
            ? types
            : Object.entries(types).map(([type, handler]) => (
                typeof handler === 'function' ? { type, handler } : handler
            ));

        for (const type of list) {
            if (type) this.registerType(type.type, type.handler);
        }

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Pause all flows in a group.
     * 
     * @param {string} group - Group name.
     * @returns {this}
     */
    pauseGroup(group) {
        const flowGroup = this.flowGroups.get(group);
        if (!flowGroup) return this;
        for (const flowId of flowGroup) {
            this.setFlowOptions({ paused: true }, flowId);
        }

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Run all flows in a group.
     * 
     * @param {string} group - Group name.
     * @returns {this}
     */
    runGroup(group) {
        const flowGroup = this.flowGroups.get(group);
        if (!flowGroup) return this;
        for (const flowId of flowGroup) {
            this.setFlowOptions({ paused: false }, flowId);
            this.runFlow(flowId);
        }

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Run a specific flow by id.
     *
     * @param {string} flowId - Flow ID.
     * @param {boolean} [withTrigger=false] - Whether to run with trigger logic.
     * @returns {this}
     */
    runFlow(flowId, withTrigger = false) {
        const processes = this.flows.get(flowId);
        const options = this.flowOptions.get(flowId);
        if (!processes || !options || options.status !== this.FLOW_STATE.READY) return this;
        this.processFlows(flowId, withTrigger);

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Get or create a flow.
     * 
     * @param {string} flowId - Flow ID.
     * @returns {Array} The flow's process array.
     */
    getOrCreateFlow(flowId) {
        if (!this.flows.has(flowId)) {
            this.flows.set(flowId, []);
            this.flowOptions.set(flowId, { 
                ...this.FLOW_OPTIONS, 
                ordered: flowId === this.FLOW_TYPE.ORDERED, 
                status: this.FLOW_STATE.READY 
            });
        }
        return this.flows.get(flowId);
    },

    /**
     * Set or update options for a flow.
     * If depends is set, pauses the flow until dependencies are resolved.
     * 
     * @param {Object} options - Flow options.
     * @param {string|boolean|null} [flowId=null] - Flow ID.
     * @returns {this}
     */
    setFlowOptions(options = {}, flowId = null) {
        /**
         * Normalize flow ID
         */
        flowId = this.normalizeFlowId(flowId);

        /**
         * Get or create flow
         */
        this.getOrCreateFlow(flowId);

        if (!options || typeof options !== 'object') return this;
        const prevOptions = this.flowOptions.get(flowId);

        /**
         * Pause flow if it has dependencies
         */
        if (Array.isArray(options.depends) && options.depends.length) {
            options.depends = [...new Set(options.depends)];
            options.paused = true;
            this.pendingFlows.add(flowId);
        }

        /**
         * Grouping flows
         */
        if (options.group) {
            if (!this.flowGroups.has(options.group)) this.flowGroups.set(options.group, new Set());
            this.flowGroups.get(options.group).add(flowId);
        }
        
        /**
         * Update options partially with fallbacks to previous state
         */
        this.flowOptions.set(flowId, { ...prevOptions, ...options });

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Check all pending flows and run those whose dependencies are now resolved.
     * 
     * @returns {void}
     */
    checkPendingFlows() {
        if (!this.pendingFlows.size) return;
        for (const pendingFlowId of this.pendingFlows) {
            const pendingOptions = this.flowOptions.get(pendingFlowId);
            if (
                pendingOptions &&
                pendingOptions.depends &&
                pendingOptions.depends.every(depId => {
                    const depOpt = this.flowOptions.get(this.normalizeFlowId(depId));
                    return depOpt && depOpt.status === this.FLOW_STATE.COMPLETED;
                })
            ) {
                this.setFlowOptions({ paused: false }, pendingFlowId);
                this.pendingFlows.delete(pendingFlowId);
                this.runFlow(pendingFlowId);
            }
        }
    },

    /**
     * Check all pending processes and run those whose dependencies are now resolved.
     * 
     * @returns {void}
     */
    checkPendingProcesses() {
        if (!this.pendingProcesses.size) return;
        for (const process of this.pendingProcesses) {
            const missingDeps = process.depends.filter(depId => {
                const hasProcess = Array.from(this.flows.values()).some(flow =>
                    flow.some(p => p.id === this.PREFIX + depId)
                );
                return !this.completedProcesses.has(this.PREFIX + depId) && !hasProcess;
            });
            if (missingDeps.length) {
                this.pendingProcesses.delete(process);
                this.log('DEP_NOT_FOUND', process.id, `${missingDeps.join(', ')}`);
                process._depsResolved = true;
                process._triggered = true;
                if (process._waitResolve) process._waitResolve();
                continue;
            }
            const allDepsCompleted = process.depends.every(depId => this.completedProcesses.has(this.PREFIX + depId));
            if (allDepsCompleted) {
                this.pendingProcesses.delete(process);
                process._depsResolved = true;
                if (process._triggered && process._waitResolve) process._waitResolve();
            }
        }
    },

    /**
     * Check if all flows/processes are complete and resolve global promise if so.
     * 
     * @returns {Promise<void>}
     */
    async maybeComplete() {
        if ( ! this.hasStarted ) return;

        /**
         * Check for pending flows missed dependencies 
         */
        if ( this.pendingFlows.size ) {
            for (const pendingFlowId of this.pendingFlows) {
                const pendingOptions = this.flowOptions.get(pendingFlowId);
                if (
                    pendingOptions &&
                    pendingOptions.depends &&
                    pendingOptions.depends.some(depId => !this.flowOptions.has(this.normalizeFlowId(depId)))
                ) {
                    this.setFlowOptions({ status: this.FLOW_STATE.COMPLETED }, pendingFlowId);
                    this.pendingFlows.delete(pendingFlowId);
                    this.log('FLOW_DEP_SKIPPED', { flow: pendingFlowId, depends: `${pendingOptions.depends.filter(depId => !this.flowOptions.has(this.normalizeFlowId(depId))).join(', ')}` });
                }
            }
        }
        
        /**
         * Check completed flows
         */
        let flowsDone = this.flowOptions.size ? Array.from(this.flowOptions.values()).every(opt => opt.status === this.FLOW_STATE.COMPLETED) : false;

        /**
         * Completion hooks run even when some flow is still outstanding, so a
         * plugin can hold work back and release it here. With no hooks
         * registered this is exactly the old behaviour: done when every flow
         * is done.
         */
        let maybeComplete = flowsDone;

        /*
         * Filter maybeComplete by completedFlowsActions
         */
        if ( this.flows.size && this.completedFlowsActions.size ) {
            for ( const cb of this.completedFlowsActions ) {
                maybeComplete = cb.call(this, flowsDone, this.flows, this.flowOptions);
            }
        }

        if ( ! maybeComplete ) return;

        if (this.completing) return;
        this.completing = true;

        this.log('ALL_COMPLETED');
        this.fire('ALL_COMPLETED');

        this.onAllComplete?.();
        if (this.globalResolve !== null) this.globalResolve();

        /**
         * Call all flows completion actions
         */
        if (this.allCompleteActions.size) {
            for (const action of this.allCompleteActions) {
                if (typeof action === 'function') action.call(this);
            }
        }

        /**
         * Reset run state unless the caller opted out (e.g. for debugging)
         */
        if (this.autoReset) this.reset();
        this.completing = false;
    },

    /**
     * Process all flows and their dependencies.
     * 
     * @param {string|null} [flowId=null] - Specific flow ID or null for all.
     * @param {boolean} [withTrigger=false] - Whether to run with trigger logic.
     * @returns {this}
     */
    processFlows(flowId = null, withTrigger = false) {
        if (!this.flows.size) return;

        /**
         * Run all flows if no specific flowId is provided
         */
        let flowIds = flowId ? [flowId] : Array.from(this.flows.keys());

        /**
         * Filter flowIds by flowIdFilters
         */
        if ( flowIds.length && this.flowIdFilters.size ) {
            for ( const cb of this.flowIdFilters ) {
                if ( typeof cb === 'function' ) flowIds = cb.call(this, flowIds);
            }
        }

        /**
         * Sort flows: flows without triggers first, then by priority
         */
        flowIds.sort((a, b) => {
            const aOpts = this.flowOptions.get(a);
            const bOpts = this.flowOptions.get(b);
            const aHasTrigger = aOpts?.trigger != null;
            const bHasTrigger = bOpts?.trigger != null;
            
            if (aHasTrigger && !bHasTrigger) return 1;
            if (!aHasTrigger && bHasTrigger) return -1;
            
            const aPriority = aOpts?.priority || 0;
            const bPriority = bOpts?.priority || 0;
            return bPriority - aPriority;
        });

        for (const fid of flowIds) {
            const options = this.flowOptions.get(fid);

            /**
             * Skip if missed options or flow is already completed
             */
            if (!options || options.status === this.FLOW_STATE.COMPLETED) continue;

            /**
             * Flow-level conditions
             */
            if ( this.getConditionStatus(options.condition) ) {
                this.setFlowOptions({ status: this.FLOW_STATE.COMPLETED }, fid);
                continue;
            }

            /**
             * Only process if not paused
             */
            if (options.paused) continue;

            /**
             * Logic for trigger on flow level
             */
            if ( flowId === null || ( flowId && ! withTrigger ) ) {
                if (options.trigger != null) {
                    const trigger = this.getTriggerFunction(options.trigger, options);
                    if (trigger) {
                        this.setFlowOptions({ paused: true }, fid);
                        let triggered = false;
                        trigger(() => {
                            if (triggered) return;
                            triggered = true;
                            this.setFlowOptions({ paused: false }, fid);
                            this.runFlow(fid, true);
                        });
                        continue;
                    }
                }
            }

            /**
             * Set flow to running state
             */
            this.setFlowOptions({ status: this.FLOW_STATE.RUNNING }, fid);

            /**
             * Run flows in parallel
             */
            (async () => {

                options.beforeStart?.();

                /**
                 * Delay per flow
                 */
                if (options.delay && options.delay > 0) {
                    await new Promise(res => setTimeout(res, options.delay));
                }

                /**
                 * Sort processes by priority
                 */
                const processes = (this.flows.get(fid) || []).slice();
                processes.sort((a, b) => (b.priority || 0) - (a.priority || 0));

                /**
                 * Preload scripts / styles
                 */
                if ( (options.preload || options.prefetch ) && ! options.trigger ) {
                    for (const p of processes) {
                        if (p.trigger) continue;
                        if ((p.type === 'script' && p.src) || (p.type === 'style' && p.href)) {
                            try {
                                const link = document.createElement('link');
                                link.rel = options.preload ? 'preload' : 'prefetch';
                                link.href = p.src || p.href;
                                link.as = p.type === 'script' ? 'script' : 'style';
                                if (p.crossOrigin) link.crossOrigin = p.crossOrigin;
                                document.head.appendChild(link);
                            } catch (e) {
                                this.error('PRELOAD_ERROR', e, p.id);
                            }
                        }
                    }
                }

                const between = (options.between !== undefined && options.between !== null)
                    ? options.between
                    : this.globalBetween;
                    
                if (options.ordered) {
                    /**
                     * Ordered: await previous process
                     */
                    let prev = Promise.resolve();
                    processes.forEach((process, idx) => {
                        prev = prev.then(async () => {
                            if (idx > 0 && between) await new Promise(res => setTimeout(res, between));
                            await this.run(process);
                        });
                    });
                    await prev;
                } else {
                    /**
                     * Unordered: run all processes in parallel
                     */
                    const promises = processes.map(async (process, idx) => {
                        if (idx > 0 && between) await new Promise(res => setTimeout(res, between));
                        return this.run(process);
                    });
                    await Promise.all(promises);
                }

                /**
                 * Set flow to completed state
                 */
                this.setFlowOptions({ status: this.FLOW_STATE.COMPLETED }, fid);
                options.onComplete?.();

                /**
                 * Check for pending flows
                 */
                this.checkPendingFlows();

                /**
                 * Maybe complete the loading
                 */
                this.maybeComplete();

            })();
        }

        /**
         * Cover skipped/empty batches that never start an async flow.
         */
        this.checkPendingFlows();
        this.maybeComplete();
    },

    /**
     * Execute a process based on its type.
     * 
     * @param {Object} process - The process object.
     * @returns {Promise<any>}
     */
    async run(process) {
        /**
         * Skip if already running or completed
         */
        if (process._running || this.getConditionStatus(process.condition)) return;
        process._running = true;

        /**
         * Setup state
         */
        if (!process._waitPromise) {
            process._triggered = false;
            process._depsResolved = false;
            process._waitPromise = new Promise(res => process._waitResolve = res);
        }

        /**
         * Trigger logic for process
         */
        if (process.trigger != null) {
            const trigger = this.getTriggerFunction(process.trigger, process);
            if (trigger) {
                trigger(() => {
                    process._triggered = true;
                    if (process._depsResolved) process._waitResolve();
                });
            } else {
                process._triggered = true;
            }
        } else {
            process._triggered = true;
        }

        /**
         * Check dependencies
         */
        if (Array.isArray(process.depends) && process.depends.length) {
            const missingDeps = process.depends.filter(depId => {
                const hasProcess = Array.from(this.flows.values()).some(flow =>
                    flow.some(p => p.id === this.PREFIX + depId)
                );
                return !this.completedProcesses.has(this.PREFIX + depId) && !hasProcess;
            });
            if (missingDeps.length) {
                this.log('DEP_NOT_FOUND', process.id, `${missingDeps.join(', ')}`);
                process._depsResolved = true;
                process._triggered = true;
                if (process._waitResolve) process._waitResolve();
            } else {
                const allDepsCompleted = process.depends.every(depId => this.completedProcesses.has(this.PREFIX + depId));
                if (!allDepsCompleted) {
                    this.pendingProcesses.add(process);
                } else {
                    process._depsResolved = true;
                    if (process._triggered) process._waitResolve();
                }
            }
        } else {
            process._depsResolved = true;
            if (process._triggered) process._waitResolve();
        }

        /**
         * Wait for both trigger and dependencies to be resolved
         */
        await process._waitPromise;

        return this.execute(process);
    },

    /**
     * Check the condition option and return true if the condition fails.
     * 
     * @param {string|Function|boolean} conditionOption - The condition option.
     * @returns {boolean} True if the condition fails, false otherwise.
     */
    getConditionStatus(opt) {
        if (opt == null) return false;
        
        if (Array.isArray(opt)) {
            return opt.some(c => this.getConditionStatus(c));
        }
        
        if (typeof opt === 'object' && opt.operator) {
            const { operator, conditions } = opt;
            if (!Array.isArray(conditions)) return false;
            
            if (operator === 'or') {
                return conditions.every(c => this.getConditionStatus(c));
            } else if (operator === 'and') {
                return conditions.some(c => this.getConditionStatus(c));
            }
            return false;
        }
        
        if (typeof opt === 'function' && !opt()) return true;
        if (typeof opt === 'boolean' && !opt) return true;

        if (this.conditionHandlers.size) {
            for (const h of this.conditionHandlers) {
                if (typeof h === 'function') {
                    const r = h.call(this, opt);
                    if (r === true || r === false) return r;
                }
            }
        }

        return false;
    },

    /**
     * Parse and return a trigger function based on the trigger option.
     * 
     * @param {string|Function|boolean} opt - The trigger option.
     * @param {Object} o - The associated process or flow object.
     * @returns {Function|null} The trigger function or null if no trigger function is found.
     */
    getTriggerFunction(opt, o) {
        if (opt == null) return null;
        
        if (typeof opt === 'function') {
            return (cb) => opt(cb);
        }
        
        /**
         * Return trigger function for array of triggers
         */
        if (Array.isArray(opt)) {
            return (cb) => {
                const vd = opt.map(t => this.getTriggerFunction(t, o)).filter(tF => tF);
                if (vd.length === 0) {
                    cb();
                    return;
                }
                let f = 0;
                const fCb = () => { if (++f === vd.length) cb(); };
                vd.forEach(tF => tF(fCb));
            };
        }
        
        /**
         * Return trigger function for object with operator and triggers
         */
        if (typeof opt === 'object' && opt.operator) {
            const { operator, triggers } = opt;
            if (!Array.isArray(triggers)) return null;
            
            if (operator === 'or') {
                return (cb) => {
                    const vd = triggers.map(t => this.getTriggerFunction(t, o)).filter(tF => tF);
                    if (vd.length === 0) {
                        cb();
                        return;
                    }
                    let f = false;
                    const fCb = () => { if (!f) { f = true; cb(); } };
                    vd.forEach(tF => tF(fCb));
                };
            } else if (operator === 'and') {
                return (cb) => {
                    const vd = triggers.map(t => this.getTriggerFunction(t, o)).filter(tF => tF);
                    if (vd.length === 0) {
                        cb();
                        return;
                    }
                    let f = 0;
                    const fCb = () => { if (++f === vd.length) cb(); };
                    vd.forEach(tF => tF(fCb));
                };
            }
            return null;
        }

        /**
         * Return trigger function from trigger handlers
         */
        if (this.triggerHandlers.size) {
            for (const h of this.triggerHandlers) {
                if (typeof h === 'function') {
                    const r = h.call(this, opt, o);
                    if (r && typeof r === 'function') return r;
                }
            }
        }
        
        /**
         * Return interaction trigger function if opt is true or 'interaction'
         */
        if (opt === true || opt === 'interaction') {
            return (cb) => this.waitForInteraction(cb);
        }
        
        return null;
    },

    /**
     * Wait for user interaction before running a callback (for interaction phase).
     * This is the default fallback trigger.
     * 
     * @param {Function} cb - The callback to run after user interaction.
     * @returns {void}
     */
    waitForInteraction(cb) {
        ['click', 'keydown', 'wheel', 'mousedown', 'mousemove', 'touchstart'].forEach(e => window.addEventListener(e, () => cb(), { once: true, passive: true }));
    },

    /**
     * Execute the process based on its type.
     * 
     * @param {Object} process - The process object.
     * @returns {Promise<any>}
     */
    async execute(process) {
        const finishProcess = async () => {
            /**
             * Call process completion actions
             */
            if (this.processCompleteActions.size) {
                for (const action of this.processCompleteActions) {
                    if (typeof action === 'function') action.call(this, process);
                }
            }
            this.completedProcesses.add(process.id);
            process._running = false;
            this.checkPendingProcesses();
        };
        if (process.skipped) {
            this.fire('SKIPPED', { ...process, id: process.id });
            finishProcess();
            return;
        }
        const handler = this.types.get(process.type);
        if (!handler) {
            this.log('UNKNOWN_TYPE', process.type, process.id);
            finishProcess();
            return;
        }
        this.fire('STARTED', { ...process, id: process.id });
        
        /**
         * Build handler callbacks from filters
         */
        const callbacks = {};
        if (this.handlerCallbacksFilters.size) {
            for (const filter of this.handlerCallbacksFilters) {
                if (typeof filter === 'function') {
                    const pluginCallbacks = filter.call(this, process);
                    if (pluginCallbacks && typeof pluginCallbacks === 'object') {
                        Object.assign(callbacks, pluginCallbacks);
                    }
                }
            }
        }
        
        /**
         * Execute handler and handle completion or error
         */
        return handler(process, callbacks)
            .then(() => {
                this.fire('COMPLETED', { ...process, id: process.id });
                finishProcess();
            })
            .catch(() => {
                this.fire('ERROR', { ...process, id: process.id });
                finishProcess();
            });
    }
};