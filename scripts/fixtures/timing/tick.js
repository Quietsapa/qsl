/**
 * Records when it ran. Served with ?delay=ms by the e2e server.
 */
(window.ran = window.ran || {})[new URL(document.currentScript.src).searchParams.get('n')] = performance.now();
