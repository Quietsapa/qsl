/**
 * QSL public entry point.
 *
 * Side-effect free: importing this module registers nothing and starts
 * nothing. Compose what you need, then call `init()` yourself. For a
 * batteries-included build see `src/presets/full.js`.
 */

export { default as core } from './core.js';
export { default } from './core.js';

export {
    Script,
    Stylesheet,
    InlineScript,
    InlineStyle,
    Pixel,
    Shadow,
    HTML,
} from './types.js';

export {
    default as conditions,
    mediaQueryCondition,
    languageCondition,
    timezoneCondition,
    urlCondition,
    userAgentCondition,
} from './plugins/conditions.js';

export {
    default as triggers,
    interactionTrigger,
    loadTrigger,
    idleTrigger,
    domReadyTrigger,
    delayTrigger,
    hoverTrigger,
    visibleTrigger,
    appearsTrigger,
    mediaQueryTrigger,
} from './plugins/triggers.js';

export { default as logger } from './plugins/logger.js';
export { default as events } from './plugins/events.js';
