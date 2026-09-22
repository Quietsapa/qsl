/**
 * Type declarations for @quietsapa/qsl.
 *
 * The runtime is plain JavaScript; these describe its public API. They are
 * checked against usage in tests/types, and README.md is checked against
 * them, so the three stay in step.
 */

/**
 * ── Triggers ────────────────────────────────────────────────────────────────
 */

/**
 * A trigger as a function: call `release` when the flow or process may start.
 */
export type TriggerFunction = (release: () => void) => void;

/**
 * Triggers a plugin adds. Extend it with an index signature for each form:
 *
 *     declare module '@quietsapa/qsl' {
 *         interface CustomTriggers {
 *             [form: `scroll:${number}`]: true;
 *         }
 *     }
 */
export interface CustomTriggers {}

/**
 * The string forms of the built-in triggers plugin.
 */
export type BuiltInTrigger =
    | 'interaction'
    | 'load'
    | 'idle'
    | 'domready'
    | `delay:${number}`
    | `hover:${string}`
    | `visible:${string}`
    | `appears:${string}`
    | `media:${string}`;

/**
 * When a flow or process is allowed to start. An array means all of them.
 * `true` is the same as `'interaction'`.
 */
export type Trigger =
    | true
    | BuiltInTrigger
    | keyof CustomTriggers
    | TriggerFunction
    | readonly Trigger[]
    | { operator: 'and' | 'or'; triggers: readonly Trigger[] };

/**
 * ── Conditions ──────────────────────────────────────────────────────────────
 */

/**
 * Conditions a plugin adds, extended the same way as `CustomTriggers`.
 */
export interface CustomConditions {}

type LanguageCondition = `lang:${'equals' | 'is' | 'contains' | 'startsWith' | 'in'}:${string}`;
type TimezoneCondition = `${'tz' | 'timezone'}:${'equals' | 'is' | 'contains' | 'offset'}:${string}`;
type UrlCondition = `url:${'contains' | 'path' | 'pathStartsWith' | 'pathEndsWith' | 'query' | 'hostname' | 'matches' | 'pathMatches'}:${string}`;
type UserAgentCondition =
    | `${'ua' | 'userAgent'}:${'contains' | 'equals' | 'is' | 'matches'}:${string}`
    | `${'ua' | 'userAgent'}:browser:${'chrome' | 'firefox' | 'safari' | 'edge' | 'opera' | 'ie' | 'chromium'}`
    | `${'ua' | 'userAgent'}:device:${'mobile' | 'tablet' | 'desktop'}`
    | `${'ua' | 'userAgent'}:${'os' | 'platform'}:${'windows' | 'mac' | 'ios' | 'android' | 'linux' | 'unix' | 'chromeos'}`;

/**
 * The string forms of the built-in conditions plugin.
 */
export type BuiltInCondition =
    | `media:${string}`
    | LanguageCondition
    | TimezoneCondition
    | UrlCondition
    | UserAgentCondition;

/**
 * Whether a flow or process runs. It is checked when it would start, and
 * again after its trigger fires. An array means all of them must pass.
 */
export type Condition =
    | boolean
    | BuiltInCondition
    | keyof CustomConditions
    | (() => unknown)
    | readonly Condition[]
    | { operator: 'and' | 'or'; conditions: readonly Condition[] };

/**
 * ── Processes ───────────────────────────────────────────────────────────────
 */

export type FetchPriority = 'high' | 'low' | 'auto';
export type CrossOrigin = 'anonymous' | 'use-credentials' | '';

/**
 * Fields every process has, whatever its type.
 */
export interface ProcessOptions {
    /** Optional; one is generated. Stored with a `qsl-` prefix. */
    id?: string;
    /** Ids of processes to wait for, as passed to `add()`, without the prefix. */
    depends?: readonly string[];
    condition?: Condition;
    trigger?: Trigger;
    /** Higher runs earlier within its flow. */
    priority?: number;
    /** Milliseconds to wait before the process starts. */
    delay?: number;
    /** Skip when a dependency failed or was skipped. Not set: the flow's, then the instance's. */
    strict?: boolean;
    /** Milliseconds the process may take once it starts loading; 0 for no limit. */
    timeout?: number;
    /** How many more times a failed load is attempted. */
    retries?: number;
    /** Milliseconds to wait before each retry. */
    retryDelay?: number;
    /** Rendered as `data-*` attributes on the element. */
    data?: Record<string, string | number | boolean>;
    /** Append to `<body>` instead of `<head>`. */
    footer?: boolean;
    /** Let the events plugin re-dispatch lifecycle events for this process. */
    fireEvents?: boolean;
    onBeforeStart?: (process: Process) => void | Promise<void>;
    onComplete?: () => void;
    onError?: (error: unknown) => void;
}

export interface ScriptProcess extends ProcessOptions {
    type: 'script';
    src: string;
    /** A `<script type="module">`, run by the browser as it is. */
    module?: boolean;
    async?: boolean;
    defer?: boolean;
    crossOrigin?: CrossOrigin;
    integrity?: string;
    fetchPriority?: FetchPriority;
    /** Append a timestamp to the URL. */
    bypassCache?: boolean;
}

export interface InlineScriptProcess extends ProcessOptions {
    type: 'inline-script';
    code: string;
    /** A `<script type="module">`; completes as soon as it is inserted. */
    module?: boolean;
}

export interface StylesheetProcess extends ProcessOptions {
    type: 'stylesheet';
    href: string;
    crossOrigin?: CrossOrigin;
    fetchPriority?: FetchPriority;
    bypassCache?: boolean;
}

export interface StyleProcess extends ProcessOptions {
    type: 'style';
    code: string;
}

export interface PixelProcess extends ProcessOptions {
    type: 'pixel';
    src: string;
    /** `false`: never insert the image; the request is still made. */
    dom?: boolean;
    /** Inline styles; `{ display: 'none' }` by default. */
    style?: Record<string, string>;
    fetchPriority?: FetchPriority;
    bypassCache?: boolean;
}

export interface HTMLProcess extends ProcessOptions {
    type: 'html';
    /** The element to create, e.g. `'div'`. */
    tag: string;
    html?: string;
    className?: string | readonly string[];
    style?: Record<string, string>;
}

export interface ShadowProcess extends ProcessOptions {
    type: 'shadow';
    /** A custom element's tag name; QSL waits for it to be defined. */
    tag: string;
    /** Set as the element's `data` property. */
    shadowData?: {
        /** A selector, or `'body'`. */
        container?: string;
        position?: 'top' | 'bottom';
        hidden?: boolean;
        [key: string]: unknown;
    };
}

/**
 * The default type: logs `message` through the logger.
 */
export interface ConsoleProcess extends ProcessOptions {
    type?: 'console';
    message?: string;
}

/**
 * Fields of types registered with `registerType()`, by type name:
 *
 *     declare module '@quietsapa/qsl' {
 *         interface CustomTypes {
 *             iframe: { srcdoc: string; container: string };
 *         }
 *     }
 */
export interface CustomTypes {}

type CustomProcess = {
    [K in keyof CustomTypes]: ProcessOptions & { type: K } & CustomTypes[K];
}[keyof CustomTypes];

/**
 * What `add()` accepts.
 */
export type ProcessConfig =
    | ScriptProcess
    | InlineScriptProcess
    | StylesheetProcess
    | StyleProcess
    | PixelProcess
    | HTMLProcess
    | ShadowProcess
    | ConsoleProcess
    | CustomProcess;

/**
 * A process once added: its config with the prefixed id and its flow.
 */
export type Process = ProcessConfig & {
    id: string;
    flowId: string;
};

/**
 * ── Types ───────────────────────────────────────────────────────────────────
 */

/**
 * Extra callbacks a type handler receives. Plugins add their own through
 * `handlerCallbacksFilters`.
 */
export interface HandlerCallbacks {
    /** Set during an attempt that another one may follow: clean up what it added. */
    retrying?: boolean;
    /** From the events plugin: tie an element to its process. */
    registerProcessElement?: (element: Element, process: Process) => void;
    [key: string]: unknown;
}

/**
 * A resource type: resolve when the resource is ready, reject when it failed.
 * Calling `onComplete` and `onError` is the handler's job.
 */
export type TypeHandler = (process: Process & Record<string, any>, callbacks: HandlerCallbacks) => unknown;

export interface TypeDefinition {
    type: string;
    handler: TypeHandler;
}

/**
 * ── Flows ───────────────────────────────────────────────────────────────────
 */

export interface FlowOptions {
    /** Run processes one after another. */
    ordered?: boolean;
    /** Milliseconds to wait before the flow starts. */
    delay?: number;
    /** Milliseconds between consecutive processes. */
    between?: number | null;
    /** Higher runs earlier; flows with a trigger always go last. */
    priority?: number;
    trigger?: Trigger | null;
    condition?: Condition | null;
    /** Flow ids to wait for. */
    depends?: readonly string[];
    /** Group name, for `pauseGroup()` and `runGroup()`. */
    group?: string | null;
    /** Hold the flow until `runFlow()` or `runGroup()`. */
    paused?: boolean;
    strict?: boolean;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    /** Emit `<link rel=preload>` for its scripts and stylesheets. */
    preload?: boolean;
    fireEvents?: boolean;
    /** Called when the flow starts. */
    beforeStart?: (() => void) | null;
    /** Called when the flow completes. */
    onComplete?: (() => void) | null;
}

export type FlowStatus = 'READY' | 'RUNNING' | 'COMPLETED';
export type Outcome = 'completed' | 'failed' | 'skipped';

/**
 * A flow's options as stored, with its state.
 */
export interface FlowState extends FlowOptions {
    status: FlowStatus;
    outcome?: Outcome;
}

/**
 * ── Events ──────────────────────────────────────────────────────────────────
 */

export type SkipReason = 'condition' | 'dependency' | 'circular';

export type ProcessEvent = CustomEvent<Process>;
export type ProcessErrorEvent = CustomEvent<Process & { error: unknown }>;
export type ProcessSkippedEvent = CustomEvent<Process & { reason: SkipReason | null }>;

/**
 * ── Plugins and the logger ──────────────────────────────────────────────────
 */

export type Plugin<Args extends unknown[] = []> = (qsl: QSL, ...args: Args) => void;

export interface Logger {
    log(type: string, ...args: unknown[]): void;
    error(type: string, ...args: unknown[]): void;
}

/**
 * ── The instance ────────────────────────────────────────────────────────────
 */

export interface QSL {
    readonly VERSION: string;

    /** Instance default for `strict`. `false` unless set. */
    strict: boolean;
    /** Instance default for `timeout`, in ms. `0`, no limit, unless set. */
    timeout: number;
    /** Instance default for `retries`. `0` unless set. */
    retries: number;
    /** Instance default for `retryDelay`, in ms. `0` unless set. */
    retryDelay: number;
    /** Yield to the main thread before each process, where `scheduler.yield()` exists. */
    yield: boolean;
    /** Reset run state once every flow completes. */
    autoReset: boolean;

    readonly initialized: boolean;
    /** True while a run is in progress. */
    readonly hasStarted: boolean;
    /** Whether DOMContentLoaded and load have fired, kept up to date from `init()`. */
    readonly LIFECYCLE: { DOMREADY: boolean; LOADED: boolean };

    readonly flowOptions: Map<string, FlowState>;
    /** Ids, prefixed, of every settled process: completed, failed or skipped. */
    readonly completedProcesses: Set<string>;
    readonly failedProcesses: Set<string>;
    readonly skippedProcesses: Set<string>;
    logger: Logger | null;

    init(): Promise<this>;
    use<Args extends unknown[]>(plugin: Plugin<Args>, ...args: Args): this;
    /** `flowId`: a name, `true` for the built-in ordered flow, or nothing for the default flow. */
    add(config: ProcessConfig, flowId?: string | true | null): this;
    /** Resolves once every flow has completed. */
    load(options?: { between?: number }): Promise<void>;
    setFlowOptions(options: FlowOptions, flowId?: string | true | null): this;
    registerType(type: string, handler: TypeHandler): this;
    registerTypes(types: TypeDefinition[] | Record<string, TypeHandler>): this;
    runFlow(flowId: string, withTrigger?: boolean): this;
    pauseGroup(group: string): this;
    runGroup(group: string): this;
    setLogger(logger: Logger): this;
    setOnAllComplete(callback: () => void): this;
    useEvents(): this;
    reset(): this;
    destroy(): this;

    /**
     * Plugin hooks. A plugin adds functions to these; each runs with the
     * instance as `this`.
     */
    readonly initActions: Set<(this: QSL) => void | Promise<void>>;
    readonly loadActions: Set<(this: QSL) => void>;
    readonly resetActions: Set<(this: QSL) => void>;
    readonly allCompleteActions: Set<(this: QSL) => void>;
    readonly processCompleteActions: Set<(this: QSL, process: Process) => void>;
    readonly addProcessFilters: Set<(this: QSL, flowId: string | true | null, config: ProcessConfig) => [string | true | null, ProcessConfig]>;
    readonly flowIdFilters: Set<(this: QSL, flowIds: string[]) => string[]>;
    readonly completedFlowsActions: Set<(this: QSL, done: boolean, flows: Map<string, Process[]>, flowOptions: Map<string, FlowState>) => boolean>;
    readonly handlerCallbacksFilters: Set<(this: QSL, process: Process) => Partial<HandlerCallbacks> | void>;
    /** Return `true` when the condition fails, `false` when it passes, `null` when it is not yours. */
    readonly conditionHandlers: Set<(this: QSL, condition: unknown) => boolean | null>;
    /** Return a trigger function for a form you handle, `null` otherwise. */
    readonly triggerHandlers: Set<(this: QSL, trigger: unknown, owner?: Process | FlowOptions) => TriggerFunction | null>;
}

/**
 * ── Exports ─────────────────────────────────────────────────────────────────
 */

declare const core: QSL;
export default core;
export { core };

export declare const Script: TypeDefinition;
export declare const Stylesheet: TypeDefinition;
export declare const InlineScript: TypeDefinition;
export declare const InlineStyle: TypeDefinition;
export declare const Pixel: TypeDefinition;
export declare const Shadow: TypeDefinition;
export declare const HTML: TypeDefinition;

/** Every built-in condition. */
export declare const conditions: Plugin;
export declare const mediaQueryCondition: Plugin;
export declare const languageCondition: Plugin;
export declare const timezoneCondition: Plugin;
export declare const urlCondition: Plugin;
export declare const userAgentCondition: Plugin;

/** Every built-in trigger. */
export declare const triggers: Plugin;
export declare const interactionTrigger: Plugin;
export declare const loadTrigger: Plugin;
export declare const idleTrigger: Plugin;
export declare const domReadyTrigger: Plugin;
export declare const delayTrigger: Plugin;
export declare const hoverTrigger: Plugin;
export declare const visibleTrigger: Plugin;
export declare const appearsTrigger: Plugin;
export declare const mediaQueryTrigger: Plugin;

export declare const logger: Plugin;
export declare const events: Plugin;

/**
 * ── Globals ─────────────────────────────────────────────────────────────────
 */

declare global {
    interface Window {
        /** The instance, set by `init()` and by the browser bundles. */
        __QSL__?: QSL;
        /** Called by `init()` when QSL was loaded with `?async=true`. */
        QSLReady?: () => void;
    }

    interface WindowEventMap {
        'QSL:started': ProcessEvent;
        'QSL:completed': ProcessEvent;
        'QSL:error': ProcessErrorEvent;
        'QSL:skipped': ProcessSkippedEvent;
        'QSL:all:completed': CustomEvent<undefined>;
    }
}
