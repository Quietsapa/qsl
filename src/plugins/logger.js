export default function(QSL) {

    QSL.initActions.add(function() {
        
        QSL.logger = {
            VERSION: 'qsl-logger',
            LOG: {
                UNKNOWN_TYPE: '[QSL] Unknown type:',
                PROCESS_STARTED: '[QSL] Process started:',
                PROCESS_COMPLETED: '[QSL] Process completed:',
                PROCESS_FAILED: '[QSL] Process failed:',
                PROCESS_SKIPPED: '[QSL] Process skipped:',
                PROCESS_TIMEOUT: '[QSL] Process timed out after (ms):',
                PROCESS_RETRY: '[QSL] Process failed, retrying (attempt):',
                PRELOAD_ERROR: '[QSL] Preload error:',
                CONDITION_FAILED: '[QSL] Condition threw, treated as failed:',
                TRIGGER_FAILED: '[QSL] Trigger threw, released:',
                CALLBACK_FAILED: '[QSL] Callback threw:',
                FLOW_DEP_SKIPPED: '[QSL] Flow dependency missed:',
                DEP_NOT_FOUND: '[QSL] Dependency not found:',
                LATE_ADD: '[QSL] Added to a flow that has already started, runs in a late flow:',
                CIRC_FLOW_DEP_SKIPPED: '[QSL] Circular flow dependency skipped:',
                CIRC_PROCESS_DEP_SKIPPED: '[QSL] Circular process dependency skipped:',
                RESET: '[QSL] Global reset',
                ALL_COMPLETED: '[QSL] Loading is completed',
            },
            log(type, ...args) {
                if (this.LOG[type]) {
                    console.log(this.LOG[type], ...args, { timestamp: Date.now() });
                } else {
                    console.log('[QSL] ' + type, ...args);
                }
            },
            error(type, ...args) {
                if (this.LOG[type]) {
                    console.error(this.LOG[type], ...args);
                } else {
                    console.error('[QSL] ' + type, ...args);
                }
            }
        };
        
    });

}