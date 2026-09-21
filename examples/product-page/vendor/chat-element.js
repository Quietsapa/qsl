/**
 * Stand-in for a chat vendor that ships a custom element. Its styles live in
 * its shadow root, so nothing on the page can break them and they cannot
 * leak into the page. QSL's `shadow` type inserts the element once it has
 * been defined.
 */
customElements.define('acme-chat', class extends HTMLElement {
  connectedCallback() {
    var root = this.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      '  .panel { position: fixed; right: 16px; bottom: 76px; width: 280px; border-radius: 12px; padding: 14px;' +
      '           background: #111; color: #fff; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.25); }' +
      '  .panel[hidden] { display: none; }' +
      '  b { display: block; margin-bottom: 6px; }' +
      '</style>' +
      '<div class="panel" hidden><b>Acme support</b>Hi! Questions about sizing or delivery?</div>';
    window.demoNote('acme-chat', 'element connected, ' + (this.data.greeting || 'no greeting'));
  }
  toggle() {
    var panel = this.shadowRoot.querySelector('.panel');
    panel.hidden = !panel.hidden;
  }
});
