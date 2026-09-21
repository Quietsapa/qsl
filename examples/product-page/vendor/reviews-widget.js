/**
 * Stand-in for a reviews vendor. Real ones are configured the same way:
 * data-* attributes on their own <script> tag. QSL's `data` field writes
 * those attributes, so the tag reads its settings exactly as it would from
 * hand-written markup.
 */
(function () {
  var settings = document.currentScript.dataset;
  var target = document.querySelector(settings.target);
  target.innerHTML =
    '<div class="reviews-list">' +
    '<article><span class="stars">★★★★★</span><p>Fits perfectly, arrived in two days.</p></article>' +
    '<article><span class="stars">★★★★☆</span><p>Good quality. The colour is a bit darker than the photo.</p></article>' +
    '<article><span class="stars">★★★★★</span><p>Second one I have bought.</p></article>' +
    '</div>';
  window.demoNote('reviews-widget.js', 'rendered 3 reviews for ' + settings.product);
})();
