export default function(QSL) {

    QSL.initActions.add(function() {
        
        QSL.logger = {
            VERSION: 'qsl-logger',
            LOG: {
                LOGGER_LOADED: '[QSL] Logger loaded',
                LOGGER_LOAD_ERROR: '[QSL] Logger load error:',
                UNKNOWN_TYPE: '[QSL] Unknown type:',
                PROCESS_STARTED: '[QSL] Process started:',
                PROCESS_COMPLETED: '[QSL] Process completed:',
                PROCESS_FAILED: '[QSL] Process failed:',
                PROCESS_SKIPPED: '[QSL] Process skipped:',
                STYLESHEET_STARTED: '[QSL] Stylesheet loading:',
                STYLESHEET_LOADED: '[QSL] Stylesheet loaded:',
                STYLESHEET_FAILED: '[QSL] Stylesheet failed to load:',
                INLINE_SCRIPT_STARTED: '[QSL] Inline script loading:',
                INLINE_SCRIPT_SUCCESS: '[QSL] Inline script loaded:',
                INLINE_SCRIPT_ERROR: '[QSL] Inline script load error:',
                INLINE_STYLE_STARTED: '[QSL] Inline style loading:',
                INLINE_STYLE_SUCCESS: '[QSL] Inline style loaded:',
                INLINE_STYLE_ERROR: '[QSL] Inline style load error:',
                IMAGE_STARTED: '[QSL] Image pixel loading:',
                IMAGE_LOADED: '[QSL] Image pixel loaded:',
                IMAGE_FAILED: '[QSL] Image pixel failed:',
                SHADOW_STARTED: '[QSL] Shadow element loading:',
                SHADOW_SUCCESS: '[QSL] Shadow element loaded:',
                SHADOW_FAILED: '[QSL] Shadow element failed:',
                HTML_STARTED: '[QSL] HTML element loading:',
                HTML_SUCCESS: '[QSL] HTML element loaded:',
                HTML_FAILED: '[QSL] HTML element failed:',
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