/**
 * Stand-in for a desktop-only gallery enhancement. On a phone it would be
 * dead weight, so QSL only loads it once the viewport is wide enough.
 */
document.querySelector('.gallery').classList.add('zoomable');
window.demoNote('zoom.js', 'hover-to-zoom enabled on the gallery');
