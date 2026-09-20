import core from '../core.js';

import { Script, InlineScript, InlineStyle, Stylesheet, Pixel, Shadow, HTML } from '../types.js';

import { mediaQueryCondition, languageCondition, timezoneCondition, urlCondition, userAgentCondition } from '../plugins/conditions.js';
import { loadTrigger, idleTrigger, domReadyTrigger, delayTrigger, hoverTrigger, visibleTrigger, appearsTrigger, mediaQueryTrigger } from '../plugins/triggers.js';

import logger from '../plugins/logger.js';
import events from '../plugins/events.js';
import circ from '../plugins/circ.js';
import dynamic from '../plugins/dynamic.js';

core
    .registerTypes([Script, InlineScript, InlineStyle, Stylesheet, Pixel, Shadow, HTML])

    .use(logger)
    .use(events)
    .use(circ)
    .use(dynamic)

    .use(mediaQueryCondition)
    .use(languageCondition)
    .use(timezoneCondition)
    .use(urlCondition)
    .use(userAgentCondition)

    .use(loadTrigger)
    .use(idleTrigger)
    .use(domReadyTrigger)
    .use(delayTrigger)
    .use(hoverTrigger)
    .use(visibleTrigger)
    .use(appearsTrigger)
    .use(mediaQueryTrigger)

    .init();