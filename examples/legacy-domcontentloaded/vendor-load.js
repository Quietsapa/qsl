/**
 * The same assumption, one event later: some tags wait for every image and
 * stylesheet before they measure or paint anything.
 */
window.addEventListener('load', function () {
  window.vendorBooted('load-external');
});
