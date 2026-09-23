export default {
    VERSION: '0.8.0',
    PREFIX: 'qsl-',
    FLOW_TYPE: {
        DEFAULT: 'default',
        ORDERED: 'ordered',
    },
    FLOW_OPTIONS: {
        delay: 0,
        priority: 0,
        between: null,
        trigger: null,
        condition: null,
        onBeforeStart: null,
        onComplete: null,
        onError: null,
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
        FLOW_STARTED: 'QSL:flow:started',
        FLOW_COMPLETED: 'QSL:flow:completed',
        FLOW_ERROR: 'QSL:flow:error',
        FLOW_SKIPPED: 'QSL:flow:skipped',
        DOMREADY: 'QSL:domready',
        LOADED: 'QSL:loaded',
    },
    /**
     * Whether DOMContentLoaded and load have fired; kept current from init().
     */
    LIFECYCLE: {
        DOMREADY: false,
        LOADED: false,
    },
    CALLBACK: 'QSLReady',
    types: new Map(), // Type name -> handler

    /**
     * Every flow of the run, by id, in creation order:
     * { id, processes, options, phase, outcome, late, waits, fired }.
     * phase: 'ready' | 'armed' (waits for its trigger) | 'delay' | 'running' | 'done'.
     * waits: still waits for the flows it depends on. fired: its trigger fired.
     * late: created during the run (see add()).
     */
    flows: new Map(),
    processStates: new Map(), // Prefixed id -> 'completed' | 'failed' | 'skipped'

    /**
     * Extension points: `listeners` observe the run (see emit), condition and
     * trigger handlers add forms a config may use, handlerCallbacksFilters add to
     * what a type handler gets. Set aside until a plugin needs them, commented out
     * where they would run: completedFlowsActions, allCompleteActions
     * (maybeComplete), flowIdFilters (processFlows).
     */
    listeners: new Set(),
    conditionHandlers: new Set(),
    triggerHandlers: new Set(),
    handlerCallbacksFilters: new Set(),
    logger: null,

    debug: false, // Let the logger print progress, not only errors
    hasStarted: false, // A run is in progress
    initialized: false,

    /**
     * Settings. strict, between, timeout, retries and retryDelay are defaults:
     * a flow's or a process's own value wins.
     */
    strict: false, // Skip dependents of a failed or skipped dependency
    between: 0, // ms between processes, for flows without their own `between`
    autoReset: true, // reset() once the run completes
    yield: true, // scheduler.yield() before each process, where available
    timeout: 0, // ms a process may take once it starts loading; 0: no limit
    retries: 0, // Further attempts after a failed load
    retryDelay: 0, // ms before each retry

    /**
     * Private run state. Each process keeps its own in `_phase` ('waiting',
     * 'running', 'settled') and, while waiting, `_wait`.
     */
    _processIndex: new Map(), // Prefixed id -> process
    _waiters: new Map(), // Prefixed id -> processes waiting for it to settle
    _onAllComplete: null,
    _resolve: null, // Resolves load()'s promise
    _loading: null, // load()'s promise for this run
    _queue: null, // Adds after completion with autoReset off, for the next run
    _cyclesQueued: false, // A breakCycles() pass is due
    _done: false, // This run has completed
    _between: null, // load()'s `between`, for this run only
    _generation: 0, // Counts runs; work from a reset run is ignored

    async init() {
        if (this.initialized) return this;

        const loaderScript = document.currentScript;

        window.__QSL__ = window.__QSL__ || this;

        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            this.LIFECYCLE.DOMREADY = true;
        } else {
            document.addEventListener('DOMContentLoaded', () => this.LIFECYCLE.DOMREADY = true, { once: true });
        }

        if (document.readyState === 'complete') {
            this.LIFECYCLE.LOADED = true;
        } else {
            window.addEventListener('load', () => this.LIFECYCLE.LOADED = true, { once: true });
        }

        this.registerType('console', (process) => {
            if (process.message) this.emit('MESSAGE', 'info', process, process.message);
            this.callback(process.onComplete, process.id);
        });

        /**
         * QSL:* DOM events, as one listener. A process's detail is a copy of its
         * public fields; a flow's is its id. Both carry the error or reason if any.
         */
        this.listeners.add(function ({ type, process, flow, args }) {
            const name = /^(PROCESS|FLOW)_|^ALL_COMPLETED$/.test(type) && this.EVENTS[type.replace('PROCESS_', '').replace('FAILED', 'ERROR')];
            if (!name) return;
            let detail = null;
            if (process) {
                detail = {};
                for (const key in process) if (key[0] !== '_') detail[key] = process[key];
            } else if (type !== 'ALL_COMPLETED') {
                detail = { id: flow };
            }
            if (detail && args.length) detail[type.endsWith('FAILED') ? 'error' : 'reason'] = args[0];
            window.dispatchEvent(new CustomEvent(name, { detail }));
        });

        this.initialized = true;

        /**
         * Loaded with ?async=true: call the page's callback.
         */
        const url = loaderScript && loaderScript.src ? new URL(loaderScript.src, document.baseURI) : null;
        if (!url || url.searchParams.get('async') !== 'true') return this;

        const callback = url.searchParams.get('callback') || this.CALLBACK;
        if (typeof window[callback] === 'function') window[callback]();

        return this;
    },

    use(plugin, ...args) {
        if (typeof plugin === 'function') plugin(this, ...args);
        return this;
    },

    /**
     * Add a process to a flow.
     */
    add(config, flowId = null) {
        if (!config || typeof config !== 'object') return this;

        /**
         * Added after a run completed with autoReset off: kept for the next run.
         */
        if (this._done) {
            (this._queue ||= []).push([config, flowId]);
            return this;
        }

        /**
         * A copy: QSL keeps run state on the process.
         */
        config = { ...config };

        config.id = config.id ? this.PREFIX + config.id : this.PREFIX + Math.random().toString(36).slice(2);
        config.skipped = false;

        if (!config.type) config.type = 'console';

        if (config.depends != null) config.depends = [...new Set([].concat(config.depends))];

        /**
         * During a run, new flows are late flows: they start after the regular ones.
         */
        if (this.hasStarted) {
            if (flowId == null || flowId === false) {
                flowId = 'late-' + Math.random().toString(36).slice(2);
            } else {
                /**
                 * A started flow never sees processes pushed into it: they go to a late
                 * flow that inherits the options that still apply.
                 */
                const fid = this.normalizeFlowId(flowId);
                const flow = this.flows.get(fid);
                if (flow && !this.notStarted(flow)) {
                    const options = flow.options;
                    const lateId = fid + '+late-' + Math.random().toString(36).slice(2);
                    const inherited = {};
                    for (const key of ['condition', 'strict', 'timeout', 'retries', 'retryDelay', 'fireEvents', 'group']) {
                        if (options[key] != null) inherited[key] = options[key];
                    }
                    this.setFlowOptions(inherited, lateId);
                    this.emit('LATE_ADD', 'info', config, fid, lateId);
                    flowId = lateId;
                }
            }
        }

        const normalizedFlowId = this.normalizeFlowId(flowId);
        config.flowId = normalizedFlowId;

        /**
         * A duplicate id: dependents are released by whichever settles first.
         */
        const same = this._processIndex.get(config.id);
        if (same && same._phase !== 'settled') this.emit('DUPLICATE_ID', 'error', config);
        config._gen = this._generation;
        this.getOrCreateFlow(normalizedFlowId).processes.push(config);
        this._processIndex.set(config.id, config);
        this.emit('PROCESS_ADDED', 'info', config);

        /**
         * A process added during a run can close a cycle.
         */
        if (this.hasStarted) this.recheckCycles();

        return this;
    },

    /**
     * Start the run. Resolves when every flow is done; a second call returns the same promise.
     */
    load({ between } = {}) {
        if (this.hasStarted) return this._loading || Promise.resolve();
        this.hasStarted = true;
        this.log('LOAD');

        this._between = between ?? null;

        /**
         * Break dependency cycles before anything runs.
         */
        this.breakCycles();

        const loading = this._loading = new Promise((resolve) => { this._resolve = resolve; });
        this.processFlows();
        return loading;
    },

    /**
     * Clear the run: flows, processes, states. Plugins and types stay.
     */
    reset() {
        /**
         * Release whoever awaits the run, and ignore its work still in flight.
         */
        const resolve = this._resolve;
        this._generation++;

        this.flows.clear();
        this._processIndex.clear();
        this._waiters.clear();
        this.processStates.clear();
        this._resolve = null;
        this._loading = null;
        this.hasStarted = false;
        this._done = false;
        this._between = null;

        this.log('RESET');
        resolve?.();

        const queued = this._queue || [];
        this._queue = null;
        for (const [config, flowId] of queued) this.add(config, flowId);

        return this;
    },

    /**
     * Tear everything down, plugins and types included. init() must run again.
     */
    destroy() {
        this._queue = null;
        this.reset();

        this.types.clear();
        this.conditionHandlers.clear();
        this.triggerHandlers.clear();
        this.handlerCallbacksFilters.clear();
        this.listeners.clear();

        this.logger = null;
        this._onAllComplete = null;
        this.initialized = false;

        return this;
    },

    setLogger(logger) {
        if (logger && (typeof logger === 'function' || typeof logger === 'object')) this.logger = logger;
        return this;
    },

    setOnAllComplete(callback) {
        this._onAllComplete = typeof callback === 'function' ? callback : null;
        return this;
    },

    /**
     * Report a signal: to the logger as a key and ids, to each listener as
     * one object. Listeners run synchronously; one that throws is reported and
     * the rest go on.
     */
    emit(type, level, subject, ...args) {
        const process = subject && typeof subject === 'object' ? subject : null;
        const logger = this.logger;
        const print = logger?.[level === 'error' ? 'error' : 'log'];
        if (typeof print === 'function') {
            print.call(logger, type, ...(subject == null ? args : [process ? process.id : subject, ...args]));
        }
        if (!this.listeners.size) return;
        const signal = { type, level, time: performance.now(), process, flow: process ? process.flowId ?? null : subject ?? null, args };
        for (const listener of this.listeners) {
            try {
                listener.call(this, signal);
            } catch (e) {
                logger?.error?.('LISTENER_FAILED', e);
            }
        }
    },

    /**
     * Progress; the logger prints it only with `debug`.
     */
    log(type, ...args) {
        this.emit(type, 'info', null, ...args);
    },

    /**
     * A problem; the logger always prints it.
     */
    error(type, ...args) {
        this.emit(type, 'error', null, ...args);
    },

    /**
     * Call user or plugin code safely: a throw or a rejection is reported as
     * CALLBACK_FAILED. Returns what fn returned.
     */
    callback(fn, source = null, ...args) {
        if (typeof fn !== 'function') return;
        try {
            const result = fn.apply(this, args);
            return typeof result?.then === 'function'
                ? result.then(null, (e) => this.error('CALLBACK_FAILED', source, e))
                : result;
        } catch (e) {
            this.error('CALLBACK_FAILED', source, e);
        }
    },

    /**
     * Record how a process ended, report it, and wake its dependents. Exactly once per process.
     */
    settle(process, outcome, error) {
        if (process._phase === 'settled') return;
        process._phase = 'settled';

        /**
         * From a run that was reset: nothing to record.
         */
        if (process._gen !== this._generation) return;

        this.processStates.set(process.id, outcome);

        if (outcome === 'failed') this.emit('PROCESS_FAILED', 'error', process, error);
        else if (outcome === 'skipped') this.emit('PROCESS_SKIPPED', 'info', process, process.skipReason || null);
        else this.emit('PROCESS_COMPLETED', 'info', process);

        const waiting = this._waiters.get(process.id);
        if (waiting) {
            this._waiters.delete(process.id);
            for (const other of waiting) {
                if (other._phase === 'waiting' && !other._wait.resolved && --other._wait.count <= 0) this.resolveDependencies(other);
            }
        }
    },

    normalizeFlowId(flowId) {
        if (flowId === true) return this.FLOW_TYPE.ORDERED;
        return typeof flowId === 'string' || typeof flowId === 'number' ? String(flowId) : this.FLOW_TYPE.DEFAULT;
    },

    registerType(type, handler) {
        if (typeof type !== 'string' || typeof handler !== 'function') return this;
        this.types.set(type, handler);

        return this;
    },

    registerTypes(types) {
        if (!types || typeof types !== 'object') return this;

        /**
         * Either [{ type, handler }] or { name: handler }.
         */
        const list = Array.isArray(types)
            ? types
            : Object.entries(types).map(([type, handler]) => (
                typeof handler === 'function' ? { type, handler } : handler
            ));

        for (const type of list) {
            if (type) this.registerType(type.type, type.handler);
        }

        return this;
    },

    /**
     * The flows whose `group` is `group` right now.
     */
    inGroup(group) {
        return [...this.flows.values()].filter((flow) => flow.options.group === group).map((flow) => flow.id);
    },

    pauseGroup(group) {
        for (const flowId of this.inGroup(group)) {
            this.setFlowOptions({ paused: true }, flowId);
        }

        return this;
    },

    runGroup(group) {
        for (const flowId of this.inGroup(group)) {
            this.runFlow(flowId);
        }

        return this;
    },

    /**
     * Lift a flow's pause and start it; with `withTrigger` its trigger counts as fired.
     */
    runFlow(flowId, withTrigger = false) {
        flowId = this.normalizeFlowId(flowId);
        const flow = this.flows.get(flowId);

        /**
         * Paused and released within its delay: it goes on.
         */
        if (flow?.phase === 'delay') return this.setFlowOptions({ paused: false }, flowId);
        if (!flow || !this.notStarted(flow)) return this;

        /**
         * Before load() only the pause is lifted.
         */
        this.setFlowOptions({ paused: false }, flowId);
        if (!this.hasStarted) return this;

        /**
         * Still waiting for dependency flows: start (or skip) once they are done.
         */
        if (flow.waits) {
            this.checkPendingFlows();
            this.maybeComplete();
            return this;
        }
        this.processFlows(flowId, withTrigger);
        return this;
    },

    getOrCreateFlow(flowId) {
        let flow = this.flows.get(flowId);
        if (!flow) {
            flow = {
                id: flowId,
                processes: [],
                options: { ...this.FLOW_OPTIONS, ordered: flowId === this.FLOW_TYPE.ORDERED },
                phase: 'ready',

                late: this.hasStarted,
                waits: false,
                fired: false,
            };
            this.flows.set(flowId, flow);
            if (this.hasStarted) this.recheckCycles();
        }
        return flow;
    },

    /**
     * Not started: ready, or waiting for its trigger.
     */
    notStarted(flow) {
        return flow.phase === 'ready' || flow.phase === 'armed';
    },

    setFlowOptions(options = {}, flowId = null) {
        const flow = this.getOrCreateFlow(this.normalizeFlowId(flowId));
        if (!options || typeof options !== 'object') return this;

        /**
         * `depends`: flow ids, a single id allowed. Only a flow not started yet can still wait.
         */
        const depends = 'depends' in options;
        const waited = flow.waits;
        if (depends) {
            options = { ...options, depends: options.depends == null ? [] : [...new Set([].concat(options.depends))] };
            if (this.notStarted(flow)) flow.waits = options.depends.length > 0;
        }

        flow.options = { ...flow.options, ...options };

        /**
         * During a run: new dependencies can close a cycle, and a flow that no
         * longer waits starts now (a late one when its turn comes).
         */
        if (depends && this.hasStarted) {
            this.recheckCycles();
            if (waited && !flow.waits && !flow.late) this.processFlows(flow.id);
        }

        return this;
    },

    /**
     * Look for cycles once the current task is done, one pass per burst of
     * adds, then start any late flow that is due.
     */
    recheckCycles() {
        if (this._cyclesQueued) return;
        this._cyclesQueued = true;
        queueMicrotask(() => {
            this._cyclesQueued = false;
            if (!this.hasStarted) return;
            this.breakCycles(true);

            this.maybeComplete();
        });
    },

    /**
     * Skip everything that waits in a circle, with reason 'circular'.
     * One graph holds every kind of waiting: `depends`, ordered flows, flow
     * `depends`, late flows behind the regular ones, a flow behind its processes.
     * Flow-only cycles skip whole flows; any other cycle is broken by skipping its
     * processes that have not started. With `release`, flows waiting for a
     * skipped one are let go at once.
     */
    breakCycles(release = false) {
        const open = (flow) => flow && flow.phase !== 'done';
        const edges = new Map();
        const flowEdges = new Map();
        const regular = [];
        const running = (p) => p._phase === 'running' || p._phase === 'settled';

        /**
         * Flows are nodes by id, processes by object: a late add may reuse a running process's id.
         */
        for (const flow of this.flows.values()) {
            if (!open(flow)) continue;
            const deps = this.notStarted(flow)
                ? flow.options.depends.map((d) => this.normalizeFlowId(d)).filter((d) => open(this.flows.get(d)))
                : [];
            edges.set(flow.id, [...deps]);
            flowEdges.set(flow.id, deps);
            if (!flow.late) regular.push(flow.id);
            for (const p of flow.processes) if (p._phase !== 'settled') edges.set(p, []);
        }

        for (const flow of this.flows.values()) {
            if (!open(flow)) continue;
            const o = flow.options;

            /**
             * A process not started waits for its flow's dependency flows; a late flow
             * not started waits for the regular flows and the late flows due before it.
             */
            const waits = [...flowEdges.get(flow.id)];
            if (flow.late && this.notStarted(flow)) {
                waits.push(...regular);
                for (const other of this.flows.values()) {
                    if (other === flow) break;
                    if (other.late && open(other) && (!this.notStarted(other) || (!other.options.paused && other.options.trigger == null && !other.waits))) waits.push(other.id);
                }
            }

            let previous = null;
            for (const p of o.ordered ? flow.processes.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0)) : flow.processes) {
                if (p._phase !== 'settled') {
                    edges.get(flow.id).push(p);
                    if (!running(p)) {
                        const out = edges.get(p);
                        if (!p.skipped && Array.isArray(p.depends)) {
                            for (const dep of p.depends) {
                                const id = this.PREFIX + dep;
                                const target = this._processIndex.get(id);
                                if (target && target._phase !== 'settled' && !this.processStates.has(id)) out.push(target);
                            }
                        }
                        if (previous) out.push(previous);
                        out.push(...waits);
                    }
                }
                if (o.ordered) previous = p._phase === 'settled' ? null : p;
            }
        }

        /**
         * Both searched before anything is skipped.
         */
        const circularFlows = this.cyclic(flowEdges);
        const circular = this.cyclic(edges);

        let flowSkipped = false;
        for (const fid of circularFlows) {
            const flow = this.flows.get(fid);
            if (!this.notStarted(flow)) continue;
            this.emit('CIRC_FLOW_DEP_SKIPPED', 'error', fid, flow.options.depends);
            this.skipFlow(fid, 'circular');
            flowSkipped = true;
        }
        for (const p of circular) {
            if (!p.id || running(p) || p.skipped) continue;
            this.emit('CIRC_PROCESS_DEP_SKIPPED', 'error', p, p.depends || []);
            p.skipped = true;
            p.skipReason = 'circular';

            /**
             * Already waiting: release it, and it settles as skipped.
             */
            if (p._wait) {
                p._wait.triggered = p._wait.resolved = true;
                p._wait.resolve();
            }
        }
        if (flowSkipped && release) this.checkPendingFlows();
    },

    /**
     * Nodes on a cycle (Tarjan, iterative so long chains cannot overflow the stack).
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
     * Start the flows whose dependency flows are all done.
     */
    checkPendingFlows() {
        let skipped = false;
        const find = (id) => this.flows.get(this.normalizeFlowId(id));
        for (const flow of this.flows.values()) {
            const depends = flow.options.depends;

            /**
             * Paused flows keep waiting until runFlow() or runGroup().
             */
            if (!flow.waits || flow.options.paused || !depends.every((id) => !find(id) || find(id).phase === 'done')) continue;
            flow.waits = false;

            /**
             * A missing dependency is reported and counts as skipped.
             */
            const missing = depends.filter((id) => !find(id));
            if (missing.length) this.emit('DEP_NOT_FOUND', 'error', flow.id, missing.join(', '));

            /**
             * Strict: a dependency not completed skips this flow.
             */
            const strict = flow.options.strict != null ? flow.options.strict : this.strict;
            if (strict === true && depends.some((id) => find(id)?.outcome !== 'completed')) {
                this.skipFlow(flow.id, 'dependency');
                skipped = true;
                continue;
            }

            this.runFlow(flow.id);
        }

        /**
         * A skipped flow may release the next one.
         */
        if (skipped) this.checkPendingFlows();
    },

    /**
     * End a flow without running it; its processes settle as skipped.
     */
    skipFlow(flowId, reason) {
        const flow = this.flows.get(flowId);
        flow.phase = 'done';
        flow.outcome = 'skipped';
        flow.waits = false;
        this.emit('FLOW_SKIPPED', 'info', flowId, reason);
        for (const process of flow.processes) {
            if (process._phase === 'settled') continue;
            process.skipped = true;
            process.skipReason = process.skipReason || reason;
            this.settle(process, 'skipped');
        }
    },

    /**
     * A per-process setting: the process, then its flow, then the instance.
     */
    setting(process, key) {
        if (process[key] != null) return process[key];
        const flowValue = this.flows.get(process.flowId)?.options[key];
        return flowValue != null ? flowValue : this[key];
    },

    /**
     * A per-process positive number ('timeout', 'retries', 'retryDelay'); anything else is 0.
     */
    amount(process, key) {
        const value = this.setting(process, key);
        return typeof value === 'number' && value > 0 ? (key === 'retries' ? Math.floor(value) : value) : 0;
    },

    isStrict(process) {
        return this.setting(process, 'strict') === true;
    },

    /**
     * Release a process once all its dependencies have settled. Until then it
     * is registered in `_waiters` and settle() counts down. A missing dependency is
     * reported and not waited for; strict skips on a missing, failed or skipped one.
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
            } else if (!this._processIndex.has(id)) {
                missing.push(dep);
            } else {
                waiting++;
                if (!this._waiters.has(id)) this._waiters.set(id, new Set());
                this._waiters.get(id).add(process);
            }
        }
        const wait = process._wait;
        wait.count = waiting;
        if (waiting) return false;

        /**
         * Reported once nothing else is left to wait for.
         */
        if (missing.length) this.emit('DEP_NOT_FOUND', 'error', process, missing.join(', '));

        wait.resolved = true;
        if (process.depends?.length) this.emit('PROCESS_RESOLVED', 'info', process);
        if ((unmet || missing.length) && this.isStrict(process)) {
            process.skipped = true;
            process.skipReason = 'dependency';
            wait.triggered = true;
        }

        if (wait.triggered) wait.resolve();
        return true;
    },

    /**
     * End the run once every flow is done.
     */
    maybeComplete() {
        if (!this.hasStarted || this._done) return;
        const flows = [...this.flows.values()];
        let done = flows.every((flow) => flow.phase === 'done');

        /**
         * Late flows start after every regular flow is done, one at a time, in
         * creation order. Paused ones, or ones waiting for a trigger or other flows,
         * follow their own options and do not hold up the rest.
         */
        if (!done && flows.every((flow) => flow.late || flow.phase === 'done')) {
            for (const flow of flows) {
                if (!flow.late || flow.phase === 'done') continue;
                if (flow.phase === 'delay' || flow.phase === 'running') break;
                if (flow.options.paused || flow.phase === 'armed') continue;
                if (flow.waits) {
                    this.checkPendingFlows();
                    continue;
                }
                this.processFlows(flow.id);
                if (flow.phase === 'armed') continue;
                break;
            }
        }

        /**
         * Set aside (see the properties):
         * for (const cb of this.completedFlowsActions) {
         *     const result = this.callback(cb, null, done, this.flows);
         *     if (typeof result === 'boolean') done = result;
         * }
         */
        if (!done) return;
        this._done = true;

        /**
         * With autoReset the run is cleared first, so anything done from the signal
         * or the callback belongs to the next run.
         */
        const states = new Map(this.processStates);
        if (this.autoReset) this.reset();
        else this._resolve?.();
        this.emit('ALL_COMPLETED', 'info', null, states);
        this.callback(this._onAllComplete);

        /**
         * Set aside (see the properties):
         * for (const action of this.allCompleteActions) this.callback(action);
         */
    },

    /**
     * Start the given flow, or every regular flow.
     */
    processFlows(flowId = null, withTrigger = false) {
        const flowIds = flowId
            ? [flowId]
            : [...this.flows.values()].filter((flow) => !flow.late).map((flow) => flow.id);

        /**
         * Set aside (see the properties):
         * for (const cb of this.flowIdFilters) {
         *     const result = this.callback(cb, null, flowIds);
         *     if (Array.isArray(result)) flowIds = result;
         * }
         */

        /**
         * Flows without a trigger first, then by priority.
         */
        flowIds.sort((a, b) => {
            const x = this.flows.get(a)?.options;
            const y = this.flows.get(b)?.options;
            return (x?.trigger != null) - (y?.trigger != null) || (y?.priority || 0) - (x?.priority || 0);
        });

        const gen = this._generation;
        for (const fid of flowIds) {
            const flow = this.flows.get(fid);

            /**
             * Only a flow not started (an armed one only with `withTrigger`), not
             * paused and not waiting for other flows.
             */
            if (!flow || !(flow.phase === 'ready' || (withTrigger && flow.phase === 'armed')) || flow.options.paused || flow.waits) continue;
            const options = flow.options;

            /**
             * The condition is checked now, after the trigger and after the delay.
             */
            if (this.getConditionStatus(options.condition)) {
                this.skipFlow(fid, 'condition');
                continue;
            }

            if (!withTrigger && !flow.fired && options.trigger != null) {
                const trigger = this.getTriggerFunction(options.trigger, options);
                if (trigger) {
                    flow.phase = 'armed';
                    let triggered = false;
                    trigger(() => {
                        if (triggered || gen !== this._generation) return;
                        triggered = true;
                        if (flow.phase === 'armed') flow.phase = 'ready';

                        /**
                         * Paused while armed: runFlow() or runGroup() arms it again. Otherwise the
                         * trigger is spent for good.
                         */
                        if (flow.options.paused) return;
                        flow.fired = true;
                        this.runFlow(fid, true);
                    });
                    continue;
                }
            }

            /**
             * Started: its trigger, if any, is spent, even if a pause sends it back.
             */
            flow.fired = true;
            flow.phase = options.delay > 0 ? 'delay' : 'running';

            (async () => {
                if (options.delay > 0) {
                    await new Promise(res => setTimeout(res, options.delay));
                    if (gen !== this._generation) return;
                    const now = flow.options;

                    /**
                     * Paused during the delay: back to waiting, and it no longer holds up late flows.
                     */
                    if (now.paused) {
                        flow.phase = 'ready';
                        flow.waits = now.depends.length > 0;
                        this.maybeComplete();
                        return;
                    }
                    if (this.getConditionStatus(now.condition)) {
                        this.skipFlow(fid, 'condition');
                        this.checkPendingFlows();
                        this.maybeComplete();
                        return;
                    }
                }

                flow.phase = 'running';
                this.callback(flow.options.onBeforeStart, fid);
                this.emit('FLOW_STARTED', 'info', fid);

                const processes = flow.processes.slice();
                processes.sort((a, b) => (b.priority || 0) - (a.priority || 0));

                if (options.preload && !options.trigger) {
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
                                this.emit('PRELOAD_ERROR', 'error', p, e);
                            }
                        }
                    }
                }

                /**
                 * The flow's own `between`, else load()'s, else the instance's.
                 */
                const between = options.between ?? this._between ?? this.between;

                if (options.ordered) {
                    /**
                     * Ordered: one after another. Once a process failed or was skipped (other
                     * than by its own condition), strict processes after it skip.
                     */
                    let prev = Promise.resolve();
                    let broken = false;
                    processes.forEach((process, idx) => {
                        prev = prev.then(async () => {
                            if (gen !== this._generation) return;
                            if (broken && this.isStrict(process)) {
                                process._chainBroken = true;
                            } else if (idx > 0 && between) {
                                await new Promise(res => setTimeout(res, between));
                            }
                            await this.run(process);
                            if (process.skipReason !== 'condition') broken = this.processStates.get(process.id) !== 'completed';
                        });
                    });
                    await prev;
                } else {
                    /**
                     * Unordered: all at once, the n-th staggered by n × `between`.
                     */
                    const promises = processes.map(async (process, idx) => {
                        if (idx > 0 && between) await new Promise(res => setTimeout(res, idx * between));
                        if (gen === this._generation) return this.run(process);
                    });
                    await Promise.all(promises);
                }

                /**
                 * Reset while it ran.
                 */
                if (gen !== this._generation) return;

                /**
                 * Failed if a process failed or was skipped because of a dependency.
                 */
                const tainted = processes.some(p =>
                    this.processStates.get(p.id) === 'failed' || (p.skipped && p.skipReason === 'dependency')
                );
                const outcome = tainted ? 'failed' : 'completed';
                flow.phase = 'done';
                flow.outcome = outcome;
                /**
                 * Info level: the process already reported the failure.
                 */
                if (tainted) {
                    this.emit('FLOW_FAILED', 'info', fid);
                    this.callback(flow.options.onError, fid);
                } else {
                    this.emit('FLOW_COMPLETED', 'info', fid);
                    this.callback(flow.options.onComplete, fid);
                }

                this.checkPendingFlows();

                this.maybeComplete();
            })();
        }

        /**
         * Nothing started asynchronously (all skipped or empty): finish here.
         */
        this.checkPendingFlows();
        this.maybeComplete();
    },

    /**
     * Run one process: wait for its trigger and dependencies, then execute it.
     */
    async run(process) {
        /**
         * Once per process, and only in its own run.
         */
        if (process._phase || process._gen !== this._generation) return;
        process._phase = 'waiting';

        /**
         * A failing condition skips at once, so dependents are released.
         */
        this.checkCondition(process);
        if (process.skipped) return this.execute(process);

        const trigger = process.trigger != null && this.getTriggerFunction(process.trigger, process);
        const wait = process._wait = { triggered: !trigger, resolved: false, count: 0 };
        const released = new Promise((resolve) => { wait.resolve = resolve; });
        if (trigger) {
            trigger(() => {
                if (wait.triggered) return;
                wait.triggered = true;
                this.emit('PROCESS_TRIGGERED', 'info', process);
                if (wait.resolved) wait.resolve();
            });
        }

        this.resolveDependencies(process);

        /**
         * Then its own `delay`.
         */
        await released;
        if (!process.skipped && process.delay > 0) await new Promise(res => setTimeout(res, process.delay));

        if (process._gen !== this._generation) return;

        /**
         * Yield to the main thread, so processes released together run as separate tasks.
         */
        if (this.yield && !process.skipped && globalThis.scheduler?.yield) await scheduler.yield();
        if (process._gen !== this._generation) return;

        /**
         * The condition again, just before running: the page may have changed.
         */
        this.checkCondition(process);

        /**
         * Once, outside the timeout; a throw or rejection fails the process.
         */
        if (!process.skipped && typeof process.onBeforeStart === 'function') {
            try {
                await process.onBeforeStart(process);
            } catch (e) {
                return this.fail(process, e);
            }
            if (process._gen !== this._generation) return;
        }

        return this.execute(process);
    },

    /**
     * Skip on a failing condition, or in a broken strict ordered chain.
     */
    checkCondition(process) {
        if (process.skipped) return;
        if (this.getConditionStatus(process.condition)) {
            process.skipped = true;
            process.skipReason = 'condition';
        } else if (process._chainBroken) {
            process.skipped = true;
            process.skipReason = 'dependency';
        }
    },

    /**
     * QSL gives up on a process (timeout, unknown type, onBeforeStart threw): onError once, then failed.
     */
    fail(process, error) {
        if (process._phase !== 'settled' && !process._errorReported && process._gen === this._generation) {
            process._errorReported = true;
            this.callback(process.onError, process.id, error);
        }
        this.settle(process, 'failed', error);
    },

    /**
     * True when the condition fails.
     */
    getConditionStatus(opt) {
        if (opt == null) return false;

        if (Array.isArray(opt)) {
            return opt.some(c => this.getConditionStatus(c));
        }

        if (typeof opt === 'boolean') return !opt;

        if (opt.operator === 'or' && Array.isArray(opt.conditions)) return opt.conditions.every(c => this.getConditionStatus(c));
        if (opt.operator === 'and' && Array.isArray(opt.conditions)) return opt.conditions.some(c => this.getConditionStatus(c));

        /**
         * A condition that throws or returns a promise fails.
         */
        try {
            if (typeof opt === 'function') {
                const r = opt();
                if (typeof r?.then === 'function') throw new TypeError('A condition cannot be async');
                return !r;
            }
            for (const h of this.conditionHandlers) {
                const r = typeof h === 'function' && h.call(this, opt);
                if (r === true || r === false) return r;
            }
        } catch (e) {
            this.error('CONDITION_FAILED', e);
            return true;
        }

        /**
         * Unknown form: reported, and it passes.
         */
        this.error('UNKNOWN_CONDITION', opt);
        return false;
    },

    /**
     * The trigger function for a trigger option, or null.
     */
    getTriggerFunction(opt, o) {
        if (opt == null) return null;

        /**
         * A trigger that throws releases its owner rather than holding the run.
         */
        const safe = (fn) => (cb) => {
            try {
                fn(cb);
            } catch (e) {
                this.error('TRIGGER_FAILED', e);
                cb();
            }
        };
        if (typeof opt === 'function') return safe(opt);

        /**
         * An array is 'and'. Each sub-trigger counts once; none resolved fires at once.
         */
        const all = Array.isArray(opt) ? opt : opt.operator === 'and' && opt.triggers;
        const any = opt.operator === 'or' && opt.triggers;
        if (Array.isArray(all) || Array.isArray(any)) {
            const list = (all || any).map(t => this.getTriggerFunction(t, o)).filter(Boolean);
            return (cb) => {
                if (!list.length) return cb();
                let left = all ? list.length : 1;
                list.forEach((fn) => {
                    let fired = false;
                    fn(() => {
                        if (fired) return;
                        fired = true;
                        if (--left === 0) cb();
                    });
                });
            };
        }

        for (const h of this.triggerHandlers) {
            let r;
            try {
                r = typeof h === 'function' && h.call(this, opt, o);
            } catch (e) {
                this.error('TRIGGER_FAILED', e);
                return (cb) => cb();
            }
            if (typeof r === 'function') return safe(r);
        }

        /**
         * Unknown form: reported, and nothing is held back.
         */
        this.error('UNKNOWN_TRIGGER', opt);
        return null;
    },

    /**
     * Run the type handler, with retries and the timeout, and settle the process.
     */
    async execute(process) {
        if (process.skipped) {
            this.settle(process, 'skipped');
            return;
        }
        const handler = this.types.get(process.type);
        if (!handler) return this.fail(process, new Error('Unknown type: ' + process.type));
        process._phase = 'running';
        this.emit('PROCESS_STARTED', 'info', process);

        const callbacks = {};
        for (const filter of this.handlerCallbacksFilters) {
            const pluginCallbacks = this.callback(filter, process.id, process);
            if (pluginCallbacks && typeof pluginCallbacks === 'object') Object.assign(callbacks, pluginCallbacks);
        }

        const timeout = this.amount(process, 'timeout');
        let timedOut = false;

        /**
         * onComplete and onError are guarded: neither runs after settling, onError at most once.
         */
        const own = {
            ...process,
            onComplete: process.onComplete && ((...a) => process._phase === 'settled' ? undefined : process.onComplete(...a)),
            onError: process.onError && ((...a) => {
                if (process._phase === 'settled' || process._errorReported) return;
                process._errorReported = true;
                return process.onError(...a);
            }),
        };

        /**
         * Retries share the timeout as one budget; a timed-out attempt is not
         * retried, since its resource may still arrive. Attempts before the last get
         * no onError and `callbacks.retrying`.
         */
        const retries = this.amount(process, 'retries');
        const retryDelay = retries ? this.amount(process, 'retryDelay') : 0;
        const attempt = (n) => {
            const last = n >= retries;
            return Promise.resolve()
                .then(() => last
                    ? handler(own, callbacks)
                    : handler({ ...own, onError: null }, { ...callbacks, retrying: true }))
                .catch((error) => {
                    if (last || timedOut) throw error;
                    this.emit('PROCESS_RETRY', 'info', process, n + 1);
                    if (!retryDelay) return attempt(n + 1);
                    return new Promise(res => setTimeout(res, retryDelay))
                        .then(() => timedOut ? Promise.reject(error) : attempt(n + 1));
                });
        };
        let work = attempt(0);

        /**
         * The timeout races the handler; a late resource still runs, but the process stays failed.
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
                /**
                 * A timeout is QSL's verdict, so QSL calls onError; otherwise the handler did.
                 */
                if (timedOut) return this.fail(process, error);
                this.settle(process, 'failed', error);
            });
    }
};