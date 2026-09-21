/**
 * Stand-in for a recommendations tag. It renders into the cart drawer, which
 * does not exist until the visitor adds something to the cart.
 */
document.querySelector('.cart-drawer .upsell').innerHTML =
  '<strong>Frequently bought together</strong><br>Care kit · Spare laces · Gift wrap';
window.demoNote('upsell.js', 'recommendations rendered into the cart drawer');
