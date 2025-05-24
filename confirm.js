import { cart, renderCart } from './cart.js';

export function setupConfirmLogic(turnstileToken) {
  document.getElementById('confirm-pay').addEventListener('click', () => {
    const fn = document.getElementById('fname').value.trim();
    const ln = document.getElementById('lname').value.trim();
    const customerName = `${fn} ${ln}`;
    const customerEmail = document.getElementById('email').value.trim();
    const customerRole = document.getElementById('role').value;
    const [Y, M, D] = document.getElementById('pickup-date').value.split('-');
    const pickupDate = `${D}/${M}/${Y}`;

    if (!turnstileToken) {
      alert("Please complete the human check (Turnstile).");
      return;
    }

    const grouped = {};
    cart.forEach(item => {
      if (!grouped[item.name]) grouped[item.name] = { qty: 0, price: item.price };
      grouped[item.name].qty++;
    });
    let orderDetails = '';
    Object.entries(grouped).forEach(([name, info]) => {
      orderDetails += `${info.qty}× ${name}: €${(info.price * info.qty).toFixed(2).replace('.', ',')}\n`;
    });

    const rawTotal = document.getElementById('cart-total').textContent.replace('Total: €', '').replace(',', '.');
    const formattedTotal = `${rawTotal}€`;

    let deliveryLocation = '';
    const wd = new Date(document.getElementById('pickup-date').value).getUTCDay();

    if (wd === 2) {
      deliveryLocation = `14:00–14:20 @ ${document.getElementById('location-tue').value.trim()}`;
    } else if (wd === 3) {
      const role = document.getElementById('role').value;
      if (role === 'Student') {
        deliveryLocation = `09:30–09:50 @ Virum Festsall`;
      } else {
        const choice = document.querySelector('input[name="wed-option"]:checked')?.value;
        deliveryLocation = choice === 'delivery'
          ? `10:00–10:20 @ ${document.getElementById('location-wed-input').value.trim()}`
          : `09:30–09:50 @ Proffen Konferenz`;
      }
    }

    fetch("https://vitaminboostalr.9fhw2ps22t.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: customerName,
        email: customerEmail,
        role: customerRole,
        pickup_date: pickupDate,
        delivery_location: deliveryLocation,
        order_details: orderDetails,
        total_amount: formattedTotal,
        cf_token: turnstileToken
      })
    })
    .then(res => res.json())
    .then(data => {
      emailjs.send('service_j0mv0o1', 'template_1728je9', {
        Name: customerName,
        email: customerEmail,
        order_details: orderDetails,
        total_amount: formattedTotal,
        pickup_date: pickupDate,
        user_role: customerRole,
        delivery_location: deliveryLocation,
        order_id: data.order_id
      });

      emailjs.send('service_j0mv0o1', 'template_u8nwalz', {
        Name: customerName,
        email: customerEmail,
        order_details: orderDetails,
        total_amount: formattedTotal,
        pickup_date: pickupDate,
        pickup_info: `Delivery window chosen`,
        delivery_location: deliveryLocation,
        order_id: data.order_id
      });

      cart.length = 0;
      renderCart();

      const mc = document.querySelector('#qr-modal .modal-content');
      const returnInstructions = customerRole === "Student"
        ? "🔁 Return smoothie glasses every Wednesday in front of the Festsall between 09:30–09:50."
        : `
        🔁 Return glasses anytime in the return box next to the staircase (outside Proffen Konferenz).<br><br>
        <img src="https://raw.githubusercontent.com/Arumia10/ALR-Smoothies/refs/heads/main/Pictures/Retour%20Smoothies.jpeg" 
             alt="Return Box Location" 
             style="max-width:100%; border-radius:8px; margin-top:0.5rem;" />`;

      mc.innerHTML = `
        <h2>Order Confirmed</h2>
        <p>Thank you! Your order has been confirmed.</p>
        <p><strong>Pickup Date:</strong> ${pickupDate}</p>
        <p><strong>Delivery Location:</strong> ${deliveryLocation}</p>
        <p style="margin-top: 1rem;"><strong>♻️ Please rinse your smoothie glasses before returning them.</strong></p>
        <br>
        <p>${returnInstructions}</p>
        <button id="close-confirm" class="btn">Close</button>
      `;

      document.getElementById('close-confirm').addEventListener('click', () => {
        document.getElementById('qr-modal').style.display = 'none';
        location.reload();
      });
    })
    .catch(error => {
      console.error("❌ Error sending order to server:", error);
      alert("There was an error saving your order. Please try again.");
    });
  });

  window.addEventListener('click', e => {
    if (e.target.classList.contains('modal')) {
      e.target.style.display = 'none';
    }
  });
}
