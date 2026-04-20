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
      alert("⚠️ That date is no longer available. Please choose a valid pickup day.");
      return;
    }

    if (!fn || !ln || !em || !rl || !pd) {
      alert('Please fill all fields and select a pickup date');
      return;
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

  document.getElementById('confirm-pay').addEventListener('click', async () => {
    const fn = document.getElementById('fname').value.trim();
    const ln = document.getElementById('lname').value.trim();
    const customerName = `${fn} ${ln}`;
    const customerEmail = document.getElementById('email').value.trim();
    const customerRole = document.getElementById('role').value;
    const [Y, M, D] = document.getElementById('pickup-date').value.split('-');
    const pickupDate = `${D}/${M}/${Y}`;
    const token = window.turnstileToken;

    if (!token) {
      alert("Please complete the human check (Turnstile).");
      return;
    }

    const grouped = {};
    cart.forEach(item => {
      if (!grouped[item.name]) {
        grouped[item.name] = {
          qty: 0,
          price: item.price,
          image: item.image
        };
      }
      grouped[item.name].qty++;
    });

    const orderItems = Object.entries(grouped).map(([name, info]) => ({
      name,
      qty: info.qty,
      subtotal: (info.qty * info.price).toFixed(2),
      image: info.image
    }));

    const rawTotal = document.getElementById('cart-total').textContent
      .replace('Total: €', '')
      .replace(',', '.');

    const formattedTotal = rawTotal;

    let deliveryLocation = '';
    const wd = new Date(document.getElementById('pickup-date').value).getUTCDay();

    if (wd === 3) {
      deliveryLocation = `Pickup from the fridge (outside the Proffenkonferenz)`;
    } else if (wd === 4) {
      deliveryLocation = `Pickup from the fridge (outside the Proffenkonferenz)`;
    } else if (wd === 5) {
      deliveryLocation = `Pickup from the fridge (outside the Proffenkonferenz)`;
    }

    try {
      const res = await fetch("https://vitaminboostalr.9fhw2ps22t.workers.dev/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customerName,
          email: customerEmail,
          role: customerRole,
          pickup_date: pickupDate,
          delivery_location: deliveryLocation,
          order_items: orderItems,
          total_amount: formattedTotal,
          cf_token: token
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Order submission failed");
      }

      cart.length = 0;
      renderCart();

      const mc = document.querySelector('#qr-modal .modal-content');

      const returnInstructions = `
        🔁 Please return the smoothie glasses in the return box outside the Proffenkonferenz.
        <br><br>
        <img src="https://raw.githubusercontent.com/Arumia10/ALR-Smoothies/refs/heads/main/Pictures/Retour%20Smoothies.jpeg"
             alt="Return Box Location"
             style="max-width:100%; border-radius:8px; margin-top:0.5rem;" />
      `;

      mc.innerHTML = `
        <h2>Order Confirmed</h2>
        <p>Thank you! Your order has been confirmed.</p>
        <p><strong>Order #:</strong> ${data.order_id}</p>
        <p><strong>Pickup Date:</strong> ${pickupDate}</p>
        <p><strong>Pickup Method:</strong> ${deliveryLocation}</p>
        <p style="margin-top: 1rem;"><strong>♻️ Please rinse your smoothie glasses before returning them.</strong></p>
        <br>
        <p>${returnInstructions}</p>
        <button id="close-confirm" class="btn">Close</button>
      `;

      document.getElementById('close-confirm').addEventListener('click', () => {
        document.getElementById('qr-modal').style.display = 'none';
        location.reload();
      });
    } catch (error) {
      console.error("❌ Error sending order to server:", error);
      alert("There was an error saving your order. Please try again.");
    }
  });
}
