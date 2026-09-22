import { describe, it, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { freshCore } from './helpers.js';

/**
 * Property-based tests: fast-check builds random configurations — flows and
 * processes with `depends` in every direction (missing ids, self, cycles),
 * `strict`, `ordered`, conditions, triggers, timeouts, retries, failures and
 * processes added while the run is in progress — runs each one on virtual
 * time, and checks the rules that must hold for any configuration at all.
 *
 * When a rule breaks, fast-check shrinks the configuration to the smallest one
 * that still breaks it and prints it with its seed.
 *
 *   npm test                          a few hundred configurations
 *   QSL_FUZZ_RUNS=20000 npx vitest run tests/fuzz.test.js
 */

const RUNS = Number(process.env.QSL_FUZZ_RUNS) || 300;

afterEach(() => {
    vi.useRealTimers();
});

/**
 * ── Generators ──────────────────────────────────────────────────────────────
 */

const MAX_FLOWS = 4;
const MAX_PROCESSES = 8;

const flowName = (i) => 'f' + i;
const processName = (i) => 'p' + i;

const trigger = fc.oneof(
    { weight: 6, arbitrary: fc.constant(null) },
    { weight: 2, arbitrary: fc.constant({ kind: 'now' }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('later'), ms: fc.integer({ min: 1, max: 80 }) }) },
    { weight: 1, arbitrary: fc.constant({ kind: 'twice' }) },
    { weight: 1, arbitrary: fc.constant({ kind: 'throws' }) },
);

const condition = fc.oneof(
    { weight: 8, arbitrary: fc.constant(null) },
    { weight: 2, arbitrary: fc.constant(true) },
    { weight: 2, arbitrary: fc.constant(false) },
);

const maybeBool = fc.oneof(fc.constant(undefined), fc.boolean());

/**
 * `depends` draws from every name there could be, plus names that exist
 * nowhere, so cycles, self-dependencies and dangling ids all come up.
 */
const dependsOn = (names, rare = ['ghost']) => fc.uniqueArray(
    fc.oneof({ weight: 12, arbitrary: fc.constantFrom(...names) }, { weight: 1, arbitrary: fc.constantFrom(...rare) }),
    { maxLength: 3 },
);

const behaviour = fc.oneof(
    fc.record({ kind: fc.constant('ok') }),
    fc.record({ kind: fc.constant('async'), ms: fc.integer({ min: 0, max: 60 }) }),
    fc.record({ kind: fc.constant('fail'), ms: fc.integer({ min: 0, max: 30 }) }),
    fc.record({ kind: fc.constant('flaky'), failures: fc.integer({ min: 1, max: 3 }) }),
    fc.record({ kind: fc.constant('hang') }),
    fc.record({ kind: fc.constant('throws') }),
);

const processSpec = (processNames, flowCount) => fc.record({
    flow: fc.integer({ min: 0, max: flowCount - 1 }),
    behaviour,
    depends: dependsOn(processNames),
    strict: maybeBool,
    condition,
    trigger,
    priority: fc.integer({ min: -2, max: 2 }),
    timeout: fc.oneof(fc.constant(undefined), fc.constant(0), fc.integer({ min: 5, max: 100 })),
    retries: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 2 })),
    retryDelay: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 20 })),
    late: fc.option(fc.record({
        flow: fc.oneof(fc.integer({ min: 0, max: flowCount - 1 }), fc.constant('new')),
        behaviour,
        depends: dependsOn(processNames, ['ghost', 'late']),
        strict: maybeBool,
        timeout: fc.oneof(fc.constant(undefined), fc.integer({ min: 5, max: 100 })),
    }), { freq: 4 }),
});

const flowSpec = (flowNames) => fc.record({
    ordered: fc.boolean(),
    strict: maybeBool,
    depends: fc.uniqueArray(
        fc.oneof({ weight: 12, arbitrary: fc.constantFrom(...flowNames) }, { weight: 1, arbitrary: fc.constant('ghostflow') }),
        { maxLength: 2 },
    ),
    condition,
    trigger,
    timeout: fc.oneof(fc.constant(undefined), fc.integer({ min: 5, max: 100 })),
    retries: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 2 })),
});

const configuration = fc
    .record({ flows: fc.integer({ min: 1, max: MAX_FLOWS }), processes: fc.integer({ min: 1, max: MAX_PROCESSES }) })
    .chain(({ flows, processes }) => {
        const flowNames = Array.from({ length: flows }, (_, i) => flowName(i));
        const processNames = Array.from({ length: processes }, (_, i) => processName(i));
        return fc.record({
            strict: fc.boolean(),
            timeout: fc.oneof(fc.constant(0), fc.integer({ min: 20, max: 200 })),
            flows: fc.array(flowSpec(flowNames), { minLength: flows, maxLength: flows }),
            processes: fc.array(processSpec(processNames, flows), { minLength: processes, maxLength: processes }),
        });
    })
    /**
     * A process that never answers holds the run open by design. Give every
     * one a way out, from somewhere: its own timeout, its flow's, or the
     * instance's.
     */
    .map((c) => {
        const effective = (own, flowTimeout) => (own != null ? own : flowTimeout != null ? flowTimeout : c.timeout);
        const hangs = (b, own, flowTimeout) => b.kind === 'hang' && !effective(own, flowTimeout);
        c.processes.forEach((p) => {
            if (hangs(p.behaviour, p.timeout, c.flows[p.flow].timeout)) p.timeout = 50;
            if (p.late && hangs(p.late.behaviour, p.late.timeout, p.late.flow === 'new' ? undefined : c.flows[p.late.flow].timeout)) p.late.timeout = 50;
        });
        return c;
    });

/**
 * ── Running a configuration ─────────────────────────────────────────────────
 */

function triggerFor(spec) {
    if (!spec) return undefined;
    if (spec.kind === 'now') return (release) => release();
    if (spec.kind === 'later') return (release) => setTimeout(release, spec.ms);
    if (spec.kind === 'twice') return (release) => { release(); setTimeout(release, 5); };
    return () => { throw new Error('trigger threw'); };
}

async function run(config) {
    vi.useFakeTimers();
    const core = await freshCore();
    core.strict = config.strict;
    core.timeout = config.timeout;
    core.autoReset = false;

    let seq = 0;
    const log = {
        starts: new Map(),
        attempts: new Map(),
        settles: new Map(),
        added: new Map(),
    };

    core.registerType('fuzz', (p) => {
        const id = p.id;
        log.attempts.set(id, (log.attempts.get(id) || 0) + 1);
        if (!log.starts.has(id)) log.starts.set(id, ++seq);
        const b = p.behaviour;

        /**
         * A process that adds another while the run is in progress.
         */
        if (p.late && log.attempts.get(id) === 1) {
            const l = p.late;
            const flow = l.flow === 'new' ? 'fnew' : flowName(l.flow);
            const lateConfig = {
                id: 'late', type: 'fuzz', behaviour: l.behaviour,
                depends: l.depends, strict: l.strict, timeout: l.timeout,
            };
            if (!log.added.has('qsl-late')) {
                log.added.set('qsl-late', { ...lateConfig, flow, isLate: true });
                core.add(lateConfig, flow);
            }
        }

        if (b.kind === 'ok') return undefined;
        if (b.kind === 'async') return new Promise((r) => setTimeout(r, b.ms));
        if (b.kind === 'fail') return new Promise((_, reject) => setTimeout(() => reject(new Error('fail')), b.ms));
        if (b.kind === 'flaky') return log.attempts.get(id) <= b.failures ? Promise.reject(new Error('flaky')) : undefined;
        if (b.kind === 'hang') return new Promise(() => {});
        throw new Error('handler threw');
    });

    core.processCompleteActions.add(function (process) {
        const entry = log.settles.get(process.id) || [];
        entry.push({ seq: ++seq, outcome: this.processStates.get(process.id) ?? outcomeOf(process), reason: process.skipReason || null });
        log.settles.set(process.id, entry);
    });

    config.flows.forEach((f, i) => {
        core.setFlowOptions({
            ordered: f.ordered,
            strict: f.strict,
            depends: f.depends,
            condition: f.condition ?? undefined,
            trigger: triggerFor(f.trigger),
            timeout: f.timeout,
            retries: f.retries,
        }, flowName(i));
    });
    config.processes.forEach((p, i) => {
        const processConfig = {
            id: processName(i), type: 'fuzz', behaviour: p.behaviour,
            depends: p.depends, strict: p.strict, condition: p.condition ?? undefined,
            trigger: triggerFor(p.trigger), priority: p.priority,
            timeout: p.timeout, retries: p.retries, retryDelay: p.retryDelay, late: p.late,
        };
        log.added.set('qsl-' + processName(i), { ...processConfig, flow: flowName(p.flow) });
        core.add(processConfig, flowName(p.flow));
    });

    let resolved = false;
    core.load().then(() => { resolved = true; });
    for (let i = 0; i < 200 && !resolved; i++) await vi.advanceTimersByTimeAsync(500);

    vi.useRealTimers();
    return { core, log, resolved };
}

/**
 * processStates is written after the hooks run; read the outcome off the
 * process for the hook's own record.
 */
function outcomeOf(process) {
    return process.skipped ? 'skipped' : undefined;
}

/**
 * ── The rules ───────────────────────────────────────────────────────────────
 */

/**
 * Members of a dependency cycle: nodes that can reach themselves.
 */
function cycleMembers(nodes, depsOf) {
    const members = new Set();
    for (const start of nodes) {
        const seen = new Set();
        const stack = [...depsOf(start)];
        while (stack.length) {
            const n = stack.pop();
            if (n === start) { members.add(start); break; }
            if (seen.has(n)) continue;
            seen.add(n);
            stack.push(...depsOf(n));
        }
    }
    return members;
}

/**
 * Everything that could wait for what, as one graph over processes and
 * flows, from the configuration and the processes actually added: a process
 * waits for its `depends`, for the processes ahead of it in an ordered flow,
 * and for the flows its flow depends on; a flow waits for its processes; the
 * late process waits for every regular flow. Where it is not known up front
 * (which flow a late add joins, where it lands in an order) every
 * possibility is included, so this over-approximates: something skipped as
 * circular must at least be on a cycle here.
 */
function waitGraphCycles(config, log) {
    const edges = new Map();
    const node = (n) => { if (!edges.has(n)) edges.set(n, new Set()); return edges.get(n); };
    const flowDeps = (name) => config.flows[Number(name.slice(1))]?.depends || [];
    config.flows.forEach((f, i) => {
        const name = flowName(i);
        for (const d of f.depends) node('f:' + name).add('f:' + d);
    });
    const members = new Map();
    for (const [id, p] of log.added) {
        const flows = p.isLate ? [p.flow, 'late'] : [p.flow];
        for (const fl of flows) {
            node('f:' + fl).add(id);
            if (!members.has(fl)) members.set(fl, []);
            members.get(fl).push({ id, p });
            if (fl.startsWith('f') && fl !== 'fnew') for (const d of flowDeps(fl)) node(id).add('f:' + d);
        }
        for (const d of p.depends || []) node(id).add('qsl-' + d);
        if (p.isLate) config.flows.forEach((_, i) => node(id).add('f:' + flowName(i)));
    }
    config.flows.forEach((f, i) => {
        if (!f.ordered) return;
        const list = members.get(flowName(i)) || [];
        for (const a of list) {
            for (const b of list) {
                if (a === b) continue;
                if (a.p.isLate || b.p.isLate || (b.p.priority || 0) >= (a.p.priority || 0)) node(a.id).add(b.id);
            }
        }
    });
    return cycleMembers([...edges.keys()], (n) => [...(edges.get(n) || [])]);
}

function check(config, { core, log, resolved }) {
    const problems = [];
    const fail = (message) => problems.push(message);

    /**
     * 1. The run ends.
     */
    if (!resolved) fail('load() never resolved');

    const flowSpecs = new Map(config.flows.map((f, i) => [flowName(i), f]));
    const outcome = (id) => core.processStates.get(id) ?? log.settles.get(id)?.[0]?.outcome;
    const regular = [...log.added].filter(([, p]) => !p.isLate).map(([id]) => id);

    const flowCycles = cycleMembers([...flowSpecs.keys()], (f) => flowSpecs.get(f)?.depends || []);
    const processCycles = cycleMembers(regular, (id) => (log.added.get(id)?.isLate ? [] : (log.added.get(id)?.depends || []).map((d) => 'qsl-' + d).filter((d) => regular.includes(d))));

    const waitCycles = waitGraphCycles(config, log);

    for (const [id, p] of log.added) {
        const settles = log.settles.get(id) || [];
        const ran = log.starts.has(id);
        const flow = flowSpecs.get(p.flow);

        /**
         * 2. Every process settles exactly once.
         */
        if (resolved && settles.length !== 1) fail(`${id} settled ${settles.length} times`);
        if (settles.length === 0) continue;
        const settled = settles[0];

        /**
         * 3. A process starts only after everything it depends on that exists
         *    has settled.
         */
        if (ran) {
            for (const dep of p.depends || []) {
                const depId = 'qsl-' + dep;
                if (!log.added.has(depId) || depId === id) continue;
                const depSettled = log.settles.get(depId)?.[0]?.seq;
                if (depSettled === undefined || depSettled > log.starts.get(id)) {
                    fail(`${id} started before its dependency ${depId} settled`);
                }
            }
        }

        /**
         * 4. Members of a `depends` cycle never run; nothing is skipped as
         *    circular unless it can wait for itself, through any mix of
         *    `depends`, order and flows.
         */
        if (!p.isLate && processCycles.has(id) && ran) fail(`${id} is on a dependency cycle and ran`);
        if (settled.reason === 'circular' && !waitCycles.has(id) && !flowCycles.has(p.flow)) {
            fail(`${id} skipped as circular without being on a cycle`);
        }

        /**
         * 5. A failing condition, on the process or its flow, keeps it from
         *    running.
         */
        if (p.condition === false && ran) fail(`${id} ran with a failing condition`);
        if (flow?.condition === false && !p.isLate && ran) fail(`${id} ran in a flow whose condition fails`);

        /**
         * 6. A strict process never runs after a dependency failed or was
         *    skipped.
         */
        const strict = p.strict ?? flowSpecs.get(p.flow)?.strict ?? config.strict;
        if (strict && ran && (p.depends || []).includes('ghost')) fail(`strict ${id} ran with a dependency that does not exist`);
        if (strict && ran) {
            for (const dep of p.depends || []) {
                const depId = 'qsl-' + dep;
                const depOutcome = outcome(depId);
                if (log.added.has(depId) && depId !== id && (depOutcome === 'failed' || depOutcome === 'skipped')) {
                    const depSettled = log.settles.get(depId)[0].seq;
                    if (depSettled < log.starts.get(id)) fail(`strict ${id} ran after ${depId} ended ${depOutcome}`);
                }
            }
        }

        /**
         * 7. Attempts: one, plus at most `retries`.
         */
        const retries = p.retries ?? flow?.retries ?? 0;
        if ((log.attempts.get(id) || 0) > 1 + retries) fail(`${id} attempted ${log.attempts.get(id)} times with retries ${retries}`);

        /**
         * 8. The outcome matches what the handler did.
         */
        const kind = p.behaviour.kind;
        const final = outcome(id);
        if (ran && final === 'completed' && ['fail', 'hang', 'throws'].includes(kind)) fail(`${id} (${kind}) completed`);
        if (ran && kind === 'ok' && final !== 'completed') fail(`${id} (ok) ended ${final}`);
        if (!ran && final === 'completed') fail(`${id} completed without running`);
    }

    /**
     * 9. In an ordered flow, a process starts only once the one before it has
     *    settled.
     */
    config.flows.forEach((f, i) => {
        if (!f.ordered) return;
        const members = [...log.added]
            .filter(([, p]) => p.flow === flowName(i) && !p.isLate)
            .map(([id, p]) => ({ id, priority: p.priority || 0 }))
            .sort((a, b) => b.priority - a.priority);
        for (let k = 1; k < members.length; k++) {
            const prev = log.settles.get(members[k - 1].id)?.[0]?.seq;
            const start = log.starts.get(members[k].id);
            if (start !== undefined && (prev === undefined || prev > start)) {
                fail(`ordered ${flowName(i)}: ${members[k].id} started before ${members[k - 1].id} settled`);
            }
        }
    });

    return problems;
}

/**
 * ── The properties ──────────────────────────────────────────────────────────
 */

describe('any configuration', () => {
    it('ends, settles every process once, and keeps depends, strict, cycles, conditions, retries and order', async () => {
        await fc.assert(
            fc.asyncProperty(configuration, async (config) => {
                const result = await run(config);
                const problems = check(config, result);
                if (problems.length) throw new Error(problems.join('\n'));
            }),
            { numRuns: RUNS, verbose: 1 },
        );
    }, 600_000);
});
