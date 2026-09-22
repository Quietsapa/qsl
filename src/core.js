export default {
    /**
     * Constants
     */
    VERSION: '0.6.0',
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
        ALL_COMPLETED: 'QSL:all:completed',
        SKIPPED: 'QSL:skipped',
        DOMREADY: 'QSL:domready',
        LOADED: 'QSL:loaded',
    },
    /**
     * Whether DOMContentLoaded and load have fired, kept up to date from init().
     */
    LIFECYCLE: {
        DOMREADY: false,
        LOADED: false,
    },
    CALLBACK: 'QSLReady',
    /**
     * Properties
     */
    types: new Map(), // Map to store custom resource types
    flows: new Map(), // Map to store flows
    flowOptions: new Map(), // Map to store flow options

    pendingFlows: new Set(), // Set to store pending flows
    waitingFlows: new Set(), // Flows whose trigger is armed and has not fired yet
    lateFlows: new Set(), // Flows created for processes added while a run is in progress
    processIndex: new Map(), // Every process of the run, by prefixed id
    waiters: new Map(), // Prefixed id -> processes waiting for it to settle
    _cyclesQueued: false, // A breakCycles() pass is due at the end of this task
    processStates: new Map(), // Settled processes: id -> 'completed', 'failed' or 'skipped'
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
    strict: false, // Default for `strict`: skip dependents of a failed or skipped dependency
    timeout: 0, // Default for `timeout`: ms a process may take to load before it fails, 0 for no limit
    retries: 0, // Default for `retries`: how many more times a failed load is attempted
    retryDelay: 0, // Default for `retryDelay`: ms to wait before each retry
    yield: true, // Yield to the main thread before each process runs, where scheduler.yield() exists
    debug: false, // Let the logger print QSL's own progress, not only errors

    globalBetween: 0, // Global delay between processes

    /**
     * Initialize the QSL library.
     * @returns {Promise<this>}
     */
    async init() {
        if (this.initialized) return this;

        const loaderScript = document.currentScript;

        /**
         * Check if QSL is already initialized
         */
        window.__QSL__ = window.__QSL__ || this;

        /**
         * Check DOMContentLoaded state
         */
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            this.LIFECYCLE.DOMREADY = true;
        } else {
            document.addEventListener('DOMContentLoaded', () => this.LIFECYCLE.DOMREADY = true, { once: true });
        }

        /**
         * Check window load state
         */
        if (document.readyState === 'complete') {
            this.LIFECYCLE.LOADED = true;
        } else {
            window.addEventListener('load', () => this.LIFECYCLE.LOADED = true, { once: true });
        }

        /**
         * Register default type: console
         */
        this.registerType('console', (process) => {
            return new Promise((resolve) => {
                process.onBeforeStart?.();
                setTimeout(() => {
                    if ( process.message ) this.log( process.message );
                    resolve();
                    this.callback(process.onComplete, process.id);
                }, process.delay || 0);
            });
        });

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

        /**
         * Work on a copy. QSL keeps run state on the process, so reusing the
         * caller's object would carry a prefixed id and a finished state into
         * the next add() of the same config.
         */
        config = { ...config };

        /**
         * Generate ID and default to process state
         */
        config.id = config.id ? this.PREFIX + config.id : this.PREFIX + Math.random().toString(36).slice(2);
        config.skipped = false;

        /**
         * Sanitize config and set default type
         */
        if (!config.type) config.type = 'console';

        /**
         * Register process-level dependencies
         */
        if (Array.isArray(config.depends)) config.depends = [...new Set(config.depends)];

        /**
         * Filter flowId and config by addProcessFilters
         */
        if ( this.addProcessFilters.size ) {
            for ( const cb of this.addProcessFilters ) {
                if ( typeof cb === 'function' ) [flowId, config] = cb.call(this, flowId, config);
            }
        }

        /**
         * Added while a run is in progress. Any flow created now is a late
         * flow (see getOrCreateFlow), which starts once the regular flows
         * are done; the run completes when it does.
         */
        if (this.hasStarted) {
            if (!flowId) {
                /**
                 * No flow given: a late flow of its own.
                 */
                flowId = 'late-' + Math.random().toString(36).slice(2);
            } else {
                /**
                 * A flow that has already started runs from the list it had
                 * when it started, so a process pushed into it now would never
                 * run. It gets a late flow instead, carrying over the options
                 * that still mean something once the flow is under way.
                 */
                const fid = this.normalizeFlowId(flowId);
                const options = this.flowOptions.get(fid);
                if (options && options.status !== this.FLOW_STATE.READY) {
                    const lateId = fid + '+late-' + Math.random().toString(36).slice(2);
                    const inherited = {};
                    for (const key of ['condition', 'strict', 'timeout', 'retries', 'retryDelay', 'fireEvents', 'group']) {
                        if (options[key] != null) inherited[key] = options[key];
                    }
                    this.setFlowOptions(inherited, lateId);
                    this.log('LATE_ADD', config.id, fid, lateId);
                    flowId = lateId;
                }
            }
        }

        /**
         * Store flowId on process for quick lookup
         */
        const normalizedFlowId = this.normalizeFlowId(flowId);
        config.flowId = normalizedFlowId;

        /**
         * Add to flow for flow-level execution
         */
        this.getOrCreateFlow(normalizedFlowId).push(config);
        this.processIndex.set(config.id, config);

        /**
         * A process added during a run can close a cycle that was not there
         * when the run began.
         */
        if (this.hasStarted) this.recheckCycles();

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
         * A dependency cycle would wait forever: break it before anything runs
         */
        this.breakCycles();

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
        this.pendingFlows.clear();
        this.waitingFlows.clear();
        this.lateFlows.clear();
        this.processIndex.clear();
        this.waiters.clear();
        this.processStates.clear();
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
     * Call a user callback without letting it break the run.
     *
     * @param {Function} [fn]
     * @param {string} [source] - Flow or process id, for the log.
     * @returns {void}
     */
    callback(fn, source) {
        if (typeof fn !== 'function') return;
        try {
            fn();
        } catch (e) {
            this.error('CALLBACK_FAILED', source, e);
        }
    },

    /**
     * Record how a process ended, fire its event and run completion hooks.
     *
     * Every process settles exactly once, as completed, failed or skipped.
     * All three count as done for `depends`; `strict` then decides whether a
     * failed or skipped dependency is acceptable.
     *
     * @param {Object} process
     * @param {'completed'|'failed'|'skipped'} outcome
     * @param {*} [error]
     * @returns {void}
     */
    settle(process, outcome, error) {
        /**
         * Per object, not per id: ids repeat across runs and late adds.
         */
        if (process._settled) return;
        process._settled = true;

        const detail = { ...process, id: process.id };
        if (outcome === 'failed') {
            detail.error = error;
            this.fire('ERROR', detail);
        } else if (outcome === 'skipped') {
            detail.reason = process.skipReason || null;
            this.log('PROCESS_SKIPPED', process.id, detail.reason);
            this.fire('SKIPPED', detail);
        } else {
            this.log('PROCESS_COMPLETED', process.id);
            this.fire('COMPLETED', detail);
        }

        for (const action of this.processCompleteActions) {
            if (typeof action === 'function') action.call(this, process);
        }
        this.processStates.set(process.id, outcome);
        process._running = false;

        /**
         * Wake exactly the processes waiting for this one.
         */
        const waiting = this.waiters.get(process.id);
        if (waiting) {
            this.waiters.delete(process.id);
            for (const other of waiting) {
                if (!other._settled && !other._depsResolved && --other._waitingFor <= 0) this.resolveDependencies(other);
            }
        }
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

        /**
         * Accept both [{ type, handler }] and { name: handler }
         */
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
     * The flows whose `group` option is `group` right now. Read from the
     * options each time, so a flow that changes group moves with it.
     *
     * @param {string} group
     * @returns {string[]}
     */
    inGroup(group) {
        return [...this.flowOptions].filter(([, options]) => options.group === group).map(([flowId]) => flowId);
    },

    /**
     * Pause all flows in a group.
     * 
     * @param {string} group - Group name.
     * @returns {this}
     */
    pauseGroup(group) {
        for (const flowId of this.inGroup(group)) {
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
        for (const flowId of this.inGroup(group)) {
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

        /**
         * Running a flow releases it from a pause. A flow still waiting on
         * dependency flows starts once they are done, not before.
         */
        this.setFlowOptions({ paused: false }, flowId);
        if (this.pendingFlows.has(flowId)) {
            this.checkPendingFlows();
            return this;
        }
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
            /**
             * Created while a run is in progress: nothing else will start it,
             * so it runs once the regular flows are done (see maybeComplete).
             */
            if (this.hasStarted) this.lateFlows.add(flowId);
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
     * Set or update options for a flow. A flow with `depends` waits for those
     * flows to complete before it starts.
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
         * Wait for dependency flows
         */
        const depends = Array.isArray(options.depends) && options.depends.length;
        if (depends) {
            options = { ...options, depends: [...new Set(options.depends)] };
            this.pendingFlows.add(flowId);
        }

        /**
         * Update options partially with fallbacks to previous state
         */
        this.flowOptions.set(flowId, { ...prevOptions, ...options });

        /**
         * New flow dependencies during a run can close a cycle.
         */
        if (depends && this.hasStarted) this.recheckCycles();

        /**
         * Return QSL instance for chaining
         */
        return this;
    },

    /**
     * Look for cycles again once the current task is done. Processes are
     * usually added in bursts; one pass covers the whole burst. Nothing on a
     * cycle can start in the meantime, since it waits for something else on
     * the cycle, and breakCycles() lets go of whatever already waits.
     *
     * @returns {void}
     */
    recheckCycles() {
        if (this._cyclesQueued) return;
        this._cyclesQueued = true;
        queueMicrotask(() => {
            this._cyclesQueued = false;
            if (this.hasStarted) this.breakCycles(true);
        });
    },

    /**
     * Find everything that waits in a circle and skip it with reason
     * 'circular'.
     *
     * One graph holds every kind of waiting: a process waits for the
     * processes in its `depends`, for the one before it in an ordered flow,
     * and, until its flow starts, for the flows its flow depends on; a late
     * flow waits for the regular flows and for the late flows that would run
     * before it; a flow waits for its processes. A cycle can run through any
     * mix of these, so they are searched together (Tarjan's algorithm, linear
     * in the size of the graph).
     *
     * Flows that depend on each other in a circle are skipped whole, as
     * before. Any other cycle passes through processes that have not started,
     * and skipping those is enough to break it: flows on it are let go once
     * their processes settle. Something that merely depends on a cycle
     * settles by the usual rules once the cycle is broken.
     *
     * Runs when load() starts, and again whenever a process or flow
     * dependencies are added during the run; then, with `release`, flows
     * waiting for a skipped one are let go at once.
     *
     * @param {boolean} [release=false]
     * @returns {void}
     */
    breakCycles(release = false) {
        const { READY, COMPLETED } = this.FLOW_STATE;
        const options = (fid) => this.flowOptions.get(fid);
        const open = (fid) => options(fid)?.status !== COMPLETED;
        const edges = new Map();
        const flowEdges = new Map();
        const regular = [];

        /**
         * Flows are nodes by id; processes by object, not id: a late add
         * may reuse the id of a process that is still running.
         */
        for (const [fid, o] of this.flowOptions) {
            if (!open(fid)) continue;
            const deps = o.status === READY ? (o.depends || []).map((d) => this.normalizeFlowId(d)).filter((d) => options(d) && open(d)) : [];
            edges.set(fid, [...deps]);
            flowEdges.set(fid, deps);
            if (!this.lateFlows.has(fid)) regular.push(fid);
        }
        for (const processes of this.flows.values()) {
            for (const p of processes) if (!p._settled) edges.set(p, []);
        }

        for (const [fid, processes] of this.flows) {
            if (!open(fid)) continue;
            const o = options(fid);

            /**
             * A process that has not started waits for the flows its flow
             * depends on. Until a late flow starts, it waits for the regular
             * flows, and for late flows before it that are running or would
             * be started first; one that is paused, waits for a trigger or
             * for other flows does not hold it up.
             */
            const waits = [...flowEdges.get(fid)];
            if (o.status === READY && this.lateFlows.has(fid)) {
                waits.push(...regular);
                for (const other of this.lateFlows) {
                    if (other === fid) break;
                    const x = options(other);
                    if (open(other) && (x.status !== READY || (!x.paused && x.trigger == null && !this.pendingFlows.has(other)))) waits.push(other);
                }
            }

            let previous = null;
            for (const p of o.ordered ? processes.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0)) : processes) {
                if (!p._settled) {
                    edges.get(fid).push(p);
                    if (!p._started) {
                        const out = edges.get(p);
                        if (!p.skipped && Array.isArray(p.depends)) {
                            for (const dep of p.depends) {
                                const id = this.PREFIX + dep;
                                const target = this.processIndex.get(id);
                                if (target && !target._settled && !this.processStates.has(id)) out.push(target);
                            }
                        }
                        if (previous) out.push(previous);
                        out.push(...waits);
                    }
                }
                if (o.ordered) previous = p._settled ? null : p;
            }
        }

        /**
         * Both searched before anything is skipped, so a `depends` cycle is
         * found even when it also runs through a flow cycle.
         */
        const circularFlows = this.cyclic(flowEdges);
        const circular = this.cyclic(edges);

        let flowSkipped = false;
        for (const fid of circularFlows) {
            if (options(fid).status !== READY) continue;
            this.error('CIRC_FLOW_DEP_SKIPPED', fid, options(fid).depends || []);
            this.pendingFlows.delete(fid);
            this.skipFlow(fid, 'circular');
            flowSkipped = true;
        }
        for (const p of circular) {
            if (!p.id || p._settled || p._started || p.skipped) continue;
            this.error('CIRC_PROCESS_DEP_SKIPPED', p.id, p.depends || []);
            p.skipped = true;
            p.skipReason = 'circular';

            /**
             * Already waiting: let it go, and it settles as skipped.
             */
            if (p._waitResolve) {
                p._triggered = p._depsResolved = true;
                p._waitResolve();
            }
        }
        if (flowSkipped && release) this.checkPendingFlows();
    },

    /**
     * The nodes of a graph that lie on a cycle: members of a strongly
     * connected component with more than one node, or with an edge to
     * itself. Tarjan's algorithm, iteratively, so a long chain cannot
     * overflow the stack.
     *
     * @param {Map<*, Array>} edges - Node to the nodes it waits for.
     * @returns {Array}
     */
    cyclic(edges) {
        const index = new Map();
        const low = new Map();
        const stack = [];
        const done = new Set();
        const found = [];
        for (const root of edges.keys()) {
            if (index.has(root)) continue;
            const work = [[root, 0]];
            while (work.length) {
                const frame = work[work.length - 1];
                const node = frame[0];
                const next = edges.get(node);
                if (!frame[1]) {
                    low.set(node, index.size);
                    index.set(node, index.size);
                    stack.push(node);
                }
                if (frame[1] < next.length) {
                    const to = next[frame[1]++];
                    if (!edges.has(to) || done.has(to)) continue;
                    if (index.has(to)) low.set(node, Math.min(low.get(node), index.get(to)));
                    else work.push([to, 0]);
                    continue;
                }
                work.pop();
                if (work.length) {
                    const parent = work[work.length - 1][0];
                    low.set(parent, Math.min(low.get(parent), low.get(node)));
                }
                if (low.get(node) === index.get(node)) {
                    const component = stack.splice(stack.lastIndexOf(node));
                    for (const member of component) done.add(member);
                    if (component.length > 1 || next.includes(node)) found.push(...component);
                }
            }
        }
        return found;
    },

    /**
     * Check all pending flows and run those whose dependencies are now resolved.
     * 
     * @returns {void}
     */
    checkPendingFlows() {
        if (!this.pendingFlows.size) return;
        let skipped = false;
        const flow = (id) => this.flowOptions.get(this.normalizeFlowId(id));
        for (const pendingFlowId of this.pendingFlows) {
            const pendingOptions = this.flowOptions.get(pendingFlowId);
            const depends = pendingOptions?.depends || [];

            /**
             * A flow it depends on does not exist: skip it, and let the flows
             * waiting for it move on.
             */
            const missing = depends.filter((id) => !flow(id));
            if (missing.length) {
                this.pendingFlows.delete(pendingFlowId);
                this.error('FLOW_DEP_SKIPPED', { flow: pendingFlowId, depends: missing.join(', ') });
                this.skipFlow(pendingFlowId, 'dependency');
                skipped = true;
                continue;
            }

            /**
             * Paused: stays pending until runFlow() or runGroup().
             */
            if (!depends.every((id) => flow(id).status === this.FLOW_STATE.COMPLETED) || pendingOptions.paused) continue;

            this.pendingFlows.delete(pendingFlowId);

            /**
             * Strict: a dependency flow that was skipped, or in which a
             * process failed, takes this flow down with it.
             */
            const strict = pendingOptions.strict != null ? pendingOptions.strict : this.strict;
            if (strict === true && depends.some((id) => flow(id).outcome !== 'completed')) {
                this.skipFlow(pendingFlowId, 'dependency');
                skipped = true;
                continue;
            }

            this.runFlow(pendingFlowId);
        }

        /**
         * A skipped flow is a completed dependency for the next one.
         */
        if (skipped) this.checkPendingFlows();
    },

    /**
     * Complete a flow without running it, and settle each of its processes as
     * skipped so that nothing depending on them waits forever.
     *
     * @param {string} flowId
     * @param {string} reason - 'condition', 'dependency', 'circular'...
     * @returns {void}
     */
    skipFlow(flowId, reason) {
        this.setFlowOptions({ status: this.FLOW_STATE.COMPLETED, outcome: 'skipped' }, flowId);
        for (const process of this.flows.get(flowId) || []) {
            if (process._settled) continue;
            process.skipped = true;
            process.skipReason = process.skipReason || reason;
            this.settle(process, 'skipped');
        }
    },

    /**
     * A per-process setting: the process's own value wins, then its flow's,
     * then the instance default.
     *
     * @param {Object} process
     * @param {string} key - 'strict', 'timeout', 'retries' or 'retryDelay'.
     * @returns {*}
     */
    setting(process, key) {
        if (process[key] != null) return process[key];
        const flowValue = this.flowOptions.get(process.flowId)?.[key];
        return flowValue != null ? flowValue : this[key];
    },

    /**
     * How long a process may take once it starts loading; 0 means no limit.
     *
     * @param {Object} process
     * @returns {number} Milliseconds, or 0.
     */
    timeoutFor(process) {
        const timeout = this.setting(process, 'timeout');
        return typeof timeout === 'number' && timeout > 0 ? timeout : 0;
    },

    /**
     * How many more times a failed load is attempted.
     *
     * @param {Object} process
     * @returns {number}
     */
    retriesFor(process) {
        const retries = this.setting(process, 'retries');
        return typeof retries === 'number' && retries > 0 ? Math.floor(retries) : 0;
    },

    /**
     * How long to wait before each retry, in ms.
     *
     * @param {Object} process
     * @returns {number}
     */
    retryDelayFor(process) {
        const delay = this.setting(process, 'retryDelay');
        return typeof delay === 'number' && delay > 0 ? delay : 0;
    },

    /**
     * Whether a process skips itself when a dependency failed or was skipped.
     *
     * @param {Object} process
     * @returns {boolean}
     */
    isStrict(process) {
        return this.setting(process, 'strict') === true;
    },

    /**
     * Resolve a process's dependencies if they are all settled.
     *
     * Each dependency is looked up among the processes that exist. One that
     * does not is reported and does not hold the process back; the others
     * are still waited for. While any is unsettled the process is recorded as
     * waiting for it and counts it; settle() counts down and comes back here
     * when the last one settles, so a process with many dependencies is
     * looked at once per dependency, not once per dependency per settle.
     *
     * Strict: a dependency that failed, was skipped or does not exist skips
     * the process, without waiting for its trigger.
     *
     * @param {Object} process
     * @returns {boolean} True when the process no longer waits on anything.
     */
    resolveDependencies(process) {
        let waiting = 0;
        let unmet = false;
        const missing = [];
        for (const dep of Array.isArray(process.depends) ? process.depends : []) {
            const id = this.PREFIX + dep;
            const state = this.processStates.get(id);
            if (state) {
                if (state !== 'completed') unmet = true;
            } else if (!this.processIndex.has(id)) {
                missing.push(dep);
            } else {
                waiting++;
                if (!this.waiters.has(id)) this.waiters.set(id, new Set());
                this.waiters.get(id).add(process);
            }
        }
        process._waitingFor = waiting;
        if (waiting) return false;

        /**
         * Reported once, when nothing else is left to wait for: a process
         * added meanwhile under that id would have been waited for.
         */
        if (missing.length) this.error('DEP_NOT_FOUND', process.id, missing.join(', '));

        process._depsResolved = true;
        if ((unmet || missing.length) && this.isStrict(process)) {
            process.skipped = true;
            process.skipReason = 'dependency';
            process._triggered = true;
        }

        if (process._triggered) process._waitResolve?.();
        return true;
    },

    /**
     * Check if all flows/processes are complete and resolve global promise if so.
     * 
     * @returns {void}
     */
    maybeComplete() {
        if ( ! this.hasStarted ) return;

        /**
         * Check completed flows
         */
        let flowsDone = this.flowOptions.size ? Array.from(this.flowOptions.values()).every(opt => opt.status === this.FLOW_STATE.COMPLETED) : false;

        /**
         * Late flows start once every regular flow is done, one at a time in
         * the order they were created. A late flow that is paused, waiting
         * for its trigger or for flows it depends on is not started here and
         * does not hold up the ones after it; it follows its own options,
         * exactly like a regular flow.
         */
        if (!flowsDone && this.lateFlows.size) {
            const regularDone = Array.from(this.flowOptions.entries()).every(([fid, opt]) =>
                this.lateFlows.has(fid) || opt.status === this.FLOW_STATE.COMPLETED
            );
            if (regularDone) {
                for (const fid of this.lateFlows) {
                    const options = this.flowOptions.get(fid);
                    if (!options || options.status === this.FLOW_STATE.COMPLETED) continue;
                    if (options.status === this.FLOW_STATE.RUNNING) break;
                    if (options.paused || this.waitingFlows.has(fid)) continue;
                    if (this.pendingFlows.has(fid)) {
                        this.checkPendingFlows();
                        continue;
                    }
                    this.processFlows(fid);
                    if (this.waitingFlows.has(fid)) continue;
                    break;
                }
            }
        }

        /**
         * Completion hooks run even when some flow is still outstanding, so a
         * plugin can hold work back and release it here. With no hooks
         * registered this is exactly the old behaviour: done when every flow
         * is done.
         */
        let maybeComplete = flowsDone;

        /**
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
        let flowIds = flowId
            ? [flowId]
            : Array.from(this.flows.keys()).filter(fid => !this.lateFlows.has(fid));

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
             * Only a flow that has not started: a running one must not be
             * started twice, a completed one is done.
             */
            if (!options || options.status !== this.FLOW_STATE.READY) continue;

            /**
             * Flow-level conditions
             */
            if ( this.getConditionStatus(options.condition) ) {
                this.skipFlow(fid, 'condition');
                continue;
            }

            /**
             * Only process if not paused, and not still waiting on
             * dependency flows (runGroup must not start those early)
             */
            if (options.paused || this.pendingFlows.has(fid)) continue;

            /**
             * Logic for trigger on flow level
             */
            if ( flowId === null || ( flowId && ! withTrigger ) ) {
                if (options.trigger != null) {
                    /**
                     * Already armed and waiting: arming again would run it twice.
                     */
                    if (this.waitingFlows.has(fid)) continue;

                    const trigger = this.getTriggerFunction(options.trigger, options);
                    if (trigger) {
                        this.waitingFlows.add(fid);
                        let triggered = false;
                        trigger(() => {
                            if (triggered) return;
                            triggered = true;
                            this.waitingFlows.delete(fid);

                            /**
                             * Paused while it waited (pauseGroup): it stays put,
                             * and runFlow() or runGroup() arms the trigger again.
                             */
                            if (this.flowOptions.get(fid)?.paused) return;
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

                this.callback(options.beforeStart, fid);

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
                if ( options.preload && ! options.trigger ) {
                    for (const p of processes) {
                        if (p.trigger) continue;
                        if ((p.type === 'script' && p.src) || (p.type === 'stylesheet' && p.href)) {
                            try {
                                const link = document.createElement('link');
                                link.rel = 'preload';
                                link.href = p.src || p.href;
                                link.as = p.type === 'script' ? 'script' : 'style';
                                if (p.crossOrigin) link.crossOrigin = p.crossOrigin;
                                if (p.fetchPriority) link.setAttribute('fetchpriority', p.fetchPriority);
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
                     * Ordered: await previous process. For `strict`, each
                     * process depends on the one before it. run() never
                     * rejects, a failure settles the process instead, so
                     * the chain is broken here: once a process failed or
                     * was skipped for a dependency, strict processes after
                     * it skip too. A skip by condition is a deliberate step
                     * and passes the previous state on.
                     */
                    let prev = Promise.resolve();
                    let broken = false;
                    processes.forEach((process, idx) => {
                        prev = prev.then(async () => {
                            if (broken && this.isStrict(process)) {
                                process.skipped = true;
                                process.skipReason = 'dependency';
                            } else if (idx > 0 && between) {
                                await new Promise(res => setTimeout(res, between));
                            }
                            await this.run(process);
                            if (this.processStates.get(process.id) === 'failed') broken = true;
                            else if (process.skipReason !== 'condition') broken = process.skipReason === 'dependency';
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
                 * Set flow to completed state. A failure inside the flow, or
                 * a process skipped because its dependency failed, marks the
                 * outcome so that strict flows depending on this one skip.
                 */
                const tainted = processes.some(p =>
                    this.processStates.get(p.id) === 'failed' || (p.skipped && p.skipReason === 'dependency')
                );
                this.setFlowOptions({ status: this.FLOW_STATE.COMPLETED, outcome: tainted ? 'failed' : 'completed' }, fid);
                this.callback(options.onComplete, fid);

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
         * Skip if already running or settled
         */
        if (process._running || process._settled) return;
        process._running = true;

        /**
         * A failing condition settles the process as skipped straight away,
         * so that anything depending on it is released instead of waiting.
         */
        if (!process.skipped && this.getConditionStatus(process.condition)) {
            process.skipped = true;
            process.skipReason = process.skipReason || 'condition';
        }
        if (process.skipped) return this.execute(process);

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
        const trigger = process.trigger != null && this.getTriggerFunction(process.trigger, process);
        if (trigger) {
            trigger(() => {
                process._triggered = true;
                if (process._depsResolved) process._waitResolve();
            });
        } else {
            process._triggered = true;
        }

        /**
         * Check dependencies
         */
        this.resolveDependencies(process);

        /**
         * Wait for both trigger and dependencies to be resolved
         */
        await process._waitPromise;

        /**
         * Check the condition again now that the process is about to run:
         * a trigger or a dependency can hold it for a long time, and the
         * page may have changed meanwhile. Flows re-check after their
         * trigger in the same way.
         */
        if (!process.skipped && this.getConditionStatus(process.condition)) {
            process.skipped = true;
            process.skipReason = 'condition';
        }

        /**
         * Give the main thread back before running: processes released
         * together (a flow starting, a dependency settling, the next in an
         * ordered chain) then run as separate tasks instead of one long
         * one, and input in between is handled at once. Where the browser
         * has no scheduler.yield() nothing changes.
         */
        if (this.yield && !process.skipped && globalThis.scheduler?.yield) await scheduler.yield();

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
        
        if (typeof opt === 'function') {
            /**
             * A condition that throws fails, like an unparseable regex.
             */
            try {
                return !opt();
            } catch (e) {
                this.error('CONDITION_FAILED', e);
                return true;
            }
        }
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
            /**
             * A trigger that throws lets the flow or process go ahead rather
             * than holding it, and the run with it, forever.
             */
            return (cb) => {
                try {
                    opt(cb);
                } catch (e) {
                    this.error('TRIGGER_FAILED', e);
                    cb();
                }
            };
        }

        /**
         * An array means all of them, the same as { operator: 'and' }
         */
        if (Array.isArray(opt)) {
            return this.getTriggerFunction({ operator: 'and', triggers: opt }, o);
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
        
        return null;
    },

    /**
     * Execute the process based on its type.
     * 
     * @param {Object} process - The process object.
     * @returns {Promise<any>}
     */
    async execute(process) {
        if (process.skipped) {
            this.settle(process, 'skipped');
            return;
        }
        const handler = this.types.get(process.type);
        if (!handler) {
            this.error('UNKNOWN_TYPE', process.type, process.id);
            this.settle(process, 'failed', new Error('Unknown type: ' + process.type));
            return;
        }
        process._started = true;
        this.log('PROCESS_STARTED', process.id);
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
        
        const timeout = this.timeoutFor(process);
        let timedOut = false;

        /**
         * Through a promise, so a handler that throws or returns something
         * other than a promise still settles the process.
         *
         * A failed attempt is retried while `retries` allow and the timeout
         * has not run out: the timeout is the budget for all attempts
         * together, and a timed-out attempt is never retried, since its
         * resource may still arrive and run. Attempts before the last get
         * a copy without onError, so onError fires once, for the outcome,
         * and `callbacks.retrying` tells the type to clean up after itself.
         * `retryDelay` is waited out before each retry, and counts against
         * the timeout like the attempts do.
         */
        const retries = this.retriesFor(process);
        const retryDelay = retries ? this.retryDelayFor(process) : 0;
        const attempt = (n) => {
            const last = n >= retries;
            return Promise.resolve()
                .then(() => last
                    ? handler(process, callbacks)
                    : handler({ ...process, onError: null }, { ...callbacks, retrying: true }))
                .catch((error) => {
                    if (last || timedOut) throw error;
                    this.log('PROCESS_RETRY', process.id, n + 1);
                    if (!retryDelay) return attempt(n + 1);
                    return new Promise(res => setTimeout(res, retryDelay))
                        .then(() => timedOut ? Promise.reject(error) : attempt(n + 1));
                });
        };
        let work = attempt(0);

        /**
         * A timeout races the handler. A request already sent cannot be
         * recalled: if the resource arrives later it still runs, but the
         * process has settled as failed and stays that way.
         */
        if (timeout) {
            let timer;
            const expiry = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error(`Timed out after ${timeout} ms`);
                    error.name = 'TimeoutError';
                    timedOut = true;
                    reject(error);
                }, timeout);
            });
            work = Promise.race([work, expiry]).finally(() => clearTimeout(timer));
        }

        return work
            .then(() => this.settle(process, 'completed'))
            .catch((error) => {
                if (error && error.name === 'TimeoutError') {
                    this.error('PROCESS_TIMEOUT', process.id, timeout);
                    if (typeof process.onError === 'function') this.callback(() => process.onError(error), process.id);
                } else {
                    this.error('PROCESS_FAILED', process.id, error);
                }
                this.settle(process, 'failed', error);
            });
    }
};