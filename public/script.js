 <!-- Loader script -->
  <script>
      window.addEventListener('load', function () {
        document.getElementById('loader').style.display = 'none';
        document.getElementById('main-content').style.display = 'block';

        // Ensure scroll to top after rendering
        setTimeout(() => window.scrollTo(0, 0), 10);
      });
  </script>
</body>

  <script>
const pickupInput = document.getElementById('pickup-date');
const roleSelect = document.getElementById('role');

function hideAllDayOptions() {
  document.getElementById('tuesday-options').classList.add('hidden');
  document.getElementById('wednesday-options').classList.add('hidden');
}

function isWednesday(dateStr) {
  return new Date(dateStr).getUTCDay() === 3;
}

function isTuesday(dateStr) {
  return new Date(dateStr).getUTCDay() === 2;
}

// Set minimum date to next Tuesday
const today = new Date();
const offset = (2 - today.getDay() + 7) % 7;
const nextTue = new Date(today);
nextTue.setDate(today.getDate() + offset);
const yyyy = nextTue.getFullYear();
const mm = String(nextTue.getMonth() + 1).padStart(2, '0');
const dd = String(nextTue.getDate()).padStart(2, '0');
pickupInput.min = `${yyyy}-${mm}-${dd}`;
pickupInput.value = pickupInput.min;
hideAllDayOptions();

function updatePickupOptions() {
  const role = roleSelect.value;
  const label = document.getElementById('pickup-date-label');
  const wrapper = document.getElementById('pickup-date-wrapper');
  const day = new Date(pickupInput.value).getUTCDay(); // 2=Tue, 3=Wed

  if (!role) {
    wrapper.classList.add('hidden');
    return;
  } else {
    wrapper.classList.remove('hidden');
  }

  // update label text
  if (role === 'Student') {
    label.textContent = 'Pickup Date (Wednesdays only)';
  } else {
    label.textContent = 'Pickup Date (Tuesdays & Wednesdays)';
  }

  hideAllDayOptions();

if (role === "Student") {
  // Update label
  label.textContent = 'Pickup Date (Wednesdays only)';

  // Hide delivery option
  document.getElementById('radio-delivery').classList.add('hidden');

  if (day !== 3) {
    pickupInput.setCustomValidity("As a student, you may only select Wednesdays.");
    pickupInput.reportValidity();
  } else {
    pickupInput.setCustomValidity('');
    document.getElementById('wednesday-options').classList.remove('hidden');
    
    // Force student to pickup only
    document.querySelector('input[name="wed-option"][value="pickup"]').checked = true;
    document.getElementById('location-wed').classList.add('hidden');
    document.getElementById('location-wed-input').value = 'Virum Festsall';
    document.getElementById('pickup-location-label').textContent = 'Virum Festsall';
  }
}
  
  else {
  label.textContent = 'Pickup Date (Tuesdays & Wednesdays)';

  // Show delivery option again
  document.getElementById('radio-delivery').classList.remove('hidden');

  // Always reset pickup label to default
  document.getElementById('pickup-location-label').textContent = 'Proffen Konferenz';

  if (day === 2) {
    document.getElementById('tuesday-options').classList.remove('hidden');
    pickupInput.setCustomValidity('');
  } else if (day === 3) {
    document.getElementById('wednesday-options').classList.remove('hidden');
    pickupInput.setCustomValidity('');

    // Clear "Virum Festsall" from delivery field if left by student
    const deliveryInput = document.getElementById('location-wed-input');
    if (deliveryInput.value === 'Virum Festsall') {
      deliveryInput.value = '';
    }
  } else {
    pickupInput.setCustomValidity('Please choose a Tuesday or Wednesday');
    pickupInput.reportValidity();
  }
}
}
// Listen to changes
pickupInput.addEventListener('input', updatePickupOptions);
roleSelect.addEventListener('change', updatePickupOptions);
    
    

// ----------------------------
// 2) Wednesday radio logic
// ----------------------------
document.querySelectorAll('input[name="wed-option"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const locWed = document.getElementById('location-wed');
    locWed.classList.toggle('hidden', radio.value !== 'delivery');
  });
});

    
// ----------------------------
// 3) Cart logic
// ----------------------------
const cart = [];

document.querySelectorAll('.btn-add').forEach(btn => {
  const card = btn.closest('.card');
  const name = card.querySelector('h3').textContent;
  const price = parseFloat(
    card.querySelector('.price').textContent
      .replace('€', '')
      .replace(',', '.')
  );
  btn.addEventListener('click', () => {
    cart.push({ name, price });
    renderCart();
    btn.textContent = "✓ Added";
    setTimeout(() => btn.textContent = "Add to Cart", 2200);
  });
});

    
// 3.1) Cart Rendering   
function renderCart() {
  const container = document.getElementById('cart-items');
  const orderBtn = document.getElementById('order-btn');
  container.innerHTML = '';

  const grouped = {};
  cart.forEach((item) => {
    if (!grouped[item.name]) {
      grouped[item.name] = { qty: 0, price: item.price };
    }
    grouped[item.name].qty++;
  });

  let total = 0;
  Object.entries(grouped).forEach(([name, info]) => {
    const lineTotal = info.price * info.qty;
    total += lineTotal;

    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <button class="btn-qty" data-name="${name}" data-action="decrease">−</button>
        <span>${info.qty}× ${name}</span>
        <button class="btn-qty" data-name="${name}" data-action="increase">+</button>
      </div>
      <div>
        <span>€${lineTotal.toFixed(2).replace('.', ',')}</span>
        <button class="btn-remove" data-name="${name}">🗑️</button>
      </div>
    `;
    container.appendChild(div);
  });

  document.getElementById('cart-total').textContent =
    `Total: €${total.toFixed(2).replace('.', ',')}`;

  // Enable or disable the order button
  orderBtn.disabled = cart.length === 0;

  attachCartHandlers();
}
    
// 3.2) Cart Handlers
    function attachCartHandlers() {
  // Adjust quantity
  document.querySelectorAll('.btn-qty').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-name');
      const action = btn.getAttribute('data-action');

      const index = cart.findIndex(item => item.name === name);
      if (index !== -1) {
        if (action === 'decrease') {
          // Remove one instance
          cart.splice(index, 1);
        } else if (action === 'increase') {
          cart.push({ name, price: cart[index].price });
        }
        renderCart();
      }
    });
  });

  // Remove all of a smoothie
  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-name');
      for (let i = cart.length - 1; i >= 0; i--) {
        if (cart[i].name === name) {
          cart.splice(i, 1);
        }
      }
      renderCart();
    });
  });
}

  // 4) Order → Details
document.getElementById('order-btn').addEventListener('click', () => {
  if (cart.length === 0) {
    // Show feedback to user
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

  renderCart();
  document.getElementById('details-total').textContent =
    document.getElementById('cart-total').textContent.split(' ')[1];
  document.getElementById('details-modal').style.display = 'flex';
});
  document.getElementById('close-details').addEventListener('click', () => {
    document.getElementById('details-modal').style.display = 'none';
  });

  // 5) Details → QR
  document.getElementById('to-payment').addEventListener('click', () => {
    const fn = document.getElementById('fname').value.trim();
    const ln = document.getElementById('lname').value.trim();
    const em = document.getElementById('email').value.trim();
    const rl = document.getElementById('role').value;
    const pd = document.getElementById('pickup-date').value;
    if (!fn || !ln || !em || !rl || !pd) {
      return alert('Please fill all fields and select a pickup date');
    }
    document.getElementById('details-modal').style.display = 'none';
    document.getElementById('qr-modal').style.display = 'flex';
  });
  document.getElementById('close-qr').addEventListener('click', () => {
    document.getElementById('qr-modal').style.display = 'none';
  });
  document.getElementById('back-btn').addEventListener('click', () => {
    document.getElementById('qr-modal').style.display = 'none';
    document.getElementById('details-modal').style.display = 'flex';
  });

  // 6) Confirm & EmailJS
  document.getElementById('confirm-pay').addEventListener('click', () => {
    // Build customer details
    const fn = document.getElementById('fname').value.trim();
    const ln = document.getElementById('lname').value.trim();
    const customerName = `${fn} ${ln}`;
    const customerEmail = document.getElementById('email').value.trim();
    const customerRole = document.getElementById('role').value;
    // Reformat pickup date
    const [Y, M, D] = document.getElementById('pickup-date').value.split('-');
    const pickupDate = `${D}/${M}/${Y}`;

    // Build order details string
    const grouped = {};
    cart.forEach(item => {
      if (!grouped[item.name]) grouped[item.name] = { qty: 0, price: item.price };
      grouped[item.name].qty++;
    });
    let orderDetails = '';
    Object.entries(grouped).forEach(([name, info]) => {
      orderDetails += `${info.qty}× ${name}: €${(info.price * info.qty)
        .toFixed(2)
        .replace('.', ',')}\n`;
    });

    // Total formatting
    const rawTotal = document.getElementById('cart-total').textContent
      .replace('Total: €', '')
      .replace(',', '.');
    const formattedTotal = `${rawTotal}€`;

    // determine which location to include
    let deliveryLocation = '';
    const wd = new Date(document.getElementById('pickup-date').value).getUTCDay();

    if (wd === 2) {
      // Tuesday delivery at fixed time
      const loc = document.getElementById('location-tue').value.trim();
      deliveryLocation = `14:00–14:20 @ ${loc}`;
    } else if (wd === 3) {
  const role = document.getElementById('role').value;

  if (role === 'Student') {
    deliveryLocation = `09:30–09:50 @ Virum Festsall`;
  } else {
    const choice = document.querySelector('input[name="wed-option"]:checked')?.value;
    if (choice === 'delivery') {
      const loc = document.getElementById('location-wed-input').value.trim();
      deliveryLocation = `10:00–10:20 @ ${loc}`;
    } else {
      deliveryLocation = `09:30–09:50 @ Proffen Konferenz`;
    }
  }
}
    // 6a) Send admin email
    emailjs.send('service_mivruy9', 'template_1728je9', {
      Name: customerName,
      email: customerEmail,
      order_details: orderDetails,
      total_amount: formattedTotal,
      pickup_date: pickupDate,
      user_role: customerRole,
      delivery_location: deliveryLocation
    })
    .then(r => console.log('Admin email sent', r.status, r.text))
    .catch(e => console.error('Admin email error', e));

    // 6b) Send customer email
    emailjs.send('service_mivruy9', 'template_u8nwalz', {
      Name: customerName,
      email: customerEmail,
      order_details: orderDetails,
      total_amount: formattedTotal,
      pickup_date: pickupDate,
      pickup_info: `Delivery window chosen`,
      delivery_location: deliveryLocation
    })
    .then(r => console.log('Customer email sent', r.status, r.text))
    .catch(e => console.error('Customer email error', e));

// 7) Save order to Cloudflare Worker before clearing cart
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
    total_amount: formattedTotal
  })
})
.then(res => res.json())
.then(data => {
  if (data.success) {
    console.log("✅ Order saved with ID:", data.order_id);
  } else {
    console.warn("⚠️ Failed to save order.");
  }

  // Proceed regardless of success for now
  cart.length = 0;
  renderCart();

  const mc = document.querySelector('#qr-modal .modal-content');
  mc.innerHTML = `
    <h2>Order Confirmed</h2>
    <p>Thank you! Your order has been confirmed.</p>
    <p><strong>Pickup Date:</strong> ${pickupDate}</p>
    <p>You can pick up or receive your smoothies as booked.</p>
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

  // 8) Dismiss modals on outside click
  window.addEventListener('click', e => {
    if (e.target.classList.contains('modal')) {
      e.target.style.display = 'none';
    }
  });
    
</script>


Moved inline JS to public/script.js
