// ----------------------------
// 3) Cart logic
// ----------------------------
export const cart = [];


export function initializeCartButtons() {
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
}

    
// 3.1) Cart Rendering   

export function renderCart() {
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
