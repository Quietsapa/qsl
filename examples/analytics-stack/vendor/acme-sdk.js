/**
 * Stand-in for an analytics SDK. The only thing that matters is that it
 * defines a global, and that everything else in the stack needs it.
 */
window.acme = {
  plugins: [],
  init: function (key) { window.demoNote('acme', 'init(' + key + ')'); },
  identify: function (id) { window.demoNote('acme', 'identify(' + id + ')'); },
  page: function () { window.demoNote('acme', 'page view sent'); },
  use: function (name) { this.plugins.push(name); window.demoNote('acme', 'plugin registered: ' + name); }
};
window.demoNote('acme-sdk.js', 'window.acme is defined');
