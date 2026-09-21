/**
 * Stand-in for a reviews tag written for server-rendered pages: it waits for
 * DOMContentLoaded before touching the DOM. In a single-page app that event
 * fired once, long ago, so without QSL's events plugin this callback would
 * never run — on the first visit to a product or on any later one.
 */
document.addEventListener('DOMContentLoaded', function () {
  var slot = document.querySelector('.product-card .reviews');
  if (slot) slot.textContent = '★★★★☆ 4.6 from 212 reviews';
  window.demoNote('reviews.js', 'DOMContentLoaded callback ran, reviews rendered');
});
