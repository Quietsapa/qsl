/**
 * An Event is printed as its type and the resource it came from. Handed to
 * the console as it is, it would keep its target, often an element already
 * removed from the page, alive for as long as the console keeps the message.
 */
const describe = (arg) => {
    if (typeof Event === 'undefined' || !(arg instanceof Event)) return arg;
    const target = arg.target || {};
    return [arg.type, target.currentSrc || target.src || target.href || target.tagName].filter(Boolean).join(' ');
};

export default function(QSL) {

    QSL.initActions.add(function() {
        
        QSL.logger = {
            VERSION: 'qsl-logger',
            LOG: {
                LOAD: '[QSL] Loading started',
                PROCESS_ADDED: '[QSL] Process added:',
                PROCESS_TRIGGERED: '[QSL] Process triggered:',
                PROCESS_RESOLVED: '[QSL] Process dependencies settled:',
                PROCESS_STARTED: '[QSL] Process started:',
                PROCESS_COMPLETED: '[QSL] Process completed:',
                PROCESS_FAILED: '[QSL] Process failed:',
                PROCESS_SKIPPED: '[QSL] Process skipped:',
                PROCESS_RETRY: '[QSL] Process failed, retrying (attempt):',
                FLOW_STARTED: '[QSL] Flow started:',
                FLOW_COMPLETED: '[QSL] Flow completed:',
                FLOW_SKIPPED: '[QSL] Flow skipped:',
                PRELOAD_ERROR: '[QSL] Preload error:',
                CONDITION_FAILED: '[QSL] Condition threw, treated as failed:',
                TRIGGER_FAILED: '[QSL] Trigger threw, released:',
                CALLBACK_FAILED: '[QSL] Callback threw:',
                LISTENER_FAILED: '[QSL] Listener threw:',
                FLOW_DEP_SKIPPED: '[QSL] Flow dependency missed:',
                DEP_NOT_FOUND: '[QSL] Dependency not found:',
                LATE_ADD: '[QSL] Added to a flow that has already started, runs in a late flow:',
                CIRC_FLOW_DEP_SKIPPED: '[QSL] Circular flow dependency skipped:',
                CIRC_PROCESS_DEP_SKIPPED: '[QSL] Circular process dependency skipped:',
                RESET: '[QSL] Global reset',
                ALL_COMPLETED: '[QSL] Loading is completed',
            },
            /**
             * QSL's own progress, the keys in LOG, is printed only with
             * `qsl.debug = true`: on a live page nobody wants a line per
             * process. Anything else, such as the `message` of a console
             * process, was asked for and is always printed.
             */
            log(type, ...args) {
                if (this.LOG[type]) {
                    if (QSL.debug) console.log(this.LOG[type], ...args.map(describe));
                } else {
                    console.log('[QSL] ' + type, ...args.map(describe));
                }
            },
            error(type, ...args) {
                console.error(this.LOG[type] || '[QSL] ' + type, ...args.map(describe));
            }
        };
        
    });

}