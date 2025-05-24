import { renderCart, cart } from './cart.js';
import { enforceMinPickupDate, updatePickupOptions } from './pickup.js';

export function initializeOrderLogic() {
  const pickupInput = document.getElementById('pickup-date');

  document.getElementById('order-btn').addEventListener('click', () => {
    if (cart.length === 0) {
      const btn = document.getElementById('order-btn');
      const originalText = btn.textContent;
      btn.textContent = '🛒 Add a smoothie first!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
      return;
    }

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const afterDeadline = (currentDay > 2) || (currentDay === 2 && currentHour >= 14);

    let minDate = new Date(now);
    if (afterDeadline) {
      const daysUntilNextTuesday = (9 - currentDay) % 7;
      minDate.setDate(now.getDate() + daysUntilNextTuesday);
    } else {
      const daysUntilThisTuesday = (2 - currentDay + 7) % 7;
      minDate.setDate(now.getDate() + daysUntilThisTuesday);
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
      document.getElementById('cart-total').textContent.split(' ')[1];
    document.getElementById('details-modal').style.display = 'flex';
  });

  document.getElementById('close-details').addEventListener('click', () => {
    document.getElementById('details-modal').style.display = 'none';
  });

  document.getElementById('to-payment').addEventListener('click', () => {
    const fn = document.getElementById('fname').value.trim();
    const ln = document.getElementById('lname').value.trim();
    const em = document.getElementById('email').value.trim();
    const rl = document.getElementById('role').value;
    const pd = pickupInput.value;

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(em)) {
      alert("Please enter a valid email address.");
      return;
    }
    if (new Date(pd) < new Date(pickupInput.min)) {
      return alert("⚠️ That date is no longer available. Please choose a valid pickup day.");
    }
    if (!fn || !ln || !em || !rl || !pd) {
      return alert('Please fill all fields and select a pickup date');
    }

    document.getElementById('details-modal').style.display = 'none';
    document.getElementById('payment-instructions').innerHTML = `
      Please scan the QR code below or 
      <a href="https://payconiq.com/t/1/653230A42C87810CB8B81D58?A=0&R=4TPCM%20Mini-Entreprise%20&D=4TPCM%20Mini-Entreprise%20" 
         target="_blank" 
         rel="noopener noreferrer" 
         style="color: #0071e3; font-weight: bold; text-decoration: underline;">
        click here to pay.
      </a>.
    `;

    document.getElementById('qr-modal').style.display = 'flex';
  });

  document.getElementById('close-qr').addEventListener('click', () => {
    document.getElementById('qr-modal').style.display = 'none';
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    document.getElementById('qr-modal').style.display = 'none';
    document.getElementById('details-modal').style.display = 'flex';
  });
}
