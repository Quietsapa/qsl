/**
 * A typical vendor tag: it assumes the document is still parsing when it
 * loads, so it defers its own setup to DOMContentLoaded.
 */
document.addEventListener('DOMContentLoaded', function () {
  window.vendorBooted('dcl-external');
});
