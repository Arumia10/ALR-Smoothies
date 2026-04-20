import { initializeCartButtons, renderCart } from './cart.js';
import { setupPickupLogic } from './pickup.js';
import { initializeOrderLogic } from './order.js';

window.turnstileToken = "";

window.onTurnstileSuccess = function(token) {
  window.turnstileToken = token;
};

window.addEventListener('load', function () {
  const loader = document.getElementById('loader');
  const mainContent = document.getElementById('main-content');

  if (loader) loader.style.display = 'none';
  if (mainContent) mainContent.style.display = 'block';

  setTimeout(() => window.scrollTo(0, 0), 10);

  initializeCartButtons();
  renderCart();
  setupPickupLogic();
  initializeOrderLogic();
});

window.addEventListener('click', e => {
  if (e.target.classList.contains('modal')) {
    e.target.style.display = 'none';
  }
});
