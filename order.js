import { renderCart, cart } from './cart.js';
import { enforceMinPickupDate, updatePickupOptions } from './pickup.js';

export function initializeOrderLogic() {
  console.log("initializeOrderLogic loaded");

  const orderBtn = document.getElementById('order-btn');
  const pickupInput = document.getElementById('pickup-date');
  const detailsModal = document.getElementById('details-modal');

  console.log("orderBtn:", orderBtn);
  console.log("pickupInput:", pickupInput);
  console.log("detailsModal:", detailsModal);

  if (!orderBtn || !pickupInput || !detailsModal) {
    console.error("Missing required element in order.js");
    return;
  }

  orderBtn.addEventListener('click', () => {
    console.log("ORDER BUTTON CLICKED");

    if (cart.length === 0) {
      const originalText = orderBtn.textContent;
      orderBtn.textContent = '🛒 Add a smoothie first!';
      orderBtn.disabled = true;
      setTimeout(() => {
        orderBtn.textContent = originalText;
        orderBtn.disabled = false;
      }, 2000);
      return;
    }

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const afterDeadline = (currentDay > 3) || (currentDay === 3 && currentHour >= 8);

    let minDate = new Date(now);

    if (afterDeadline) {
      const daysUntilNextWednesday = ((10 - currentDay) % 7) || 7;
      minDate.setDate(now.getDate() + daysUntilNextWednesday);
    } else {
      const daysUntilThisWednesday = (3 - currentDay + 7) % 7;
      minDate.setDate(now.getDate() + daysUntilThisWednesday);
    }

    const yyyy = minDate.getFullYear();
    const mm = String(minDate.getMonth() + 1).padStart(2, '0');
    const dd = String(minDate.getDate()).padStart(2, '0');
    const formattedMinDate = `${yyyy}-${mm}-${dd}`;

    pickupInput.min = formattedMinDate;
    pickupInput.value = formattedMinDate;

    enforceMinPickupDate();
    updatePickupOptions();

    renderCart();
    document.getElementById('details-total').textContent =
      document.getElementById('cart-total').textContent.replace('Total: ', '');

    detailsModal.style.display = 'flex';
    console.log("details modal opened");
  });

  document.getElementById('close-details')?.addEventListener('click', () => {
    document.getElementById('details-modal').style.display = 'none';
  });

  document.getElementById('to-payment')?.addEventListener('click', () => {
    document.getElementById('details-modal').style.display = 'none';
    document.getElementById('qr-modal').style.display = 'flex';
  });

  document.getElementById('close-qr')?.addEventListener('click', () => {
    document.getElementById('qr-modal').style.display = 'none';
  });

  document.getElementById('back-btn')?.addEventListener('click', () => {
    document.getElementById('qr-modal').style.display = 'none';
    document.getElementById('details-modal').style.display = 'flex';
  });
}
