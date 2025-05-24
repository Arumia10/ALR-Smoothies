// scripts/pickup.js
export function setupPickupLogic() {
  const pickupInput = document.getElementById('pickup-date');
  const roleSelect = document.getElementById('role');

  function enforceMinPickupDate() {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const afterDeadline = (currentDay > 2) || (currentDay === 2 && currentHour >= 14);

    let minDate = new Date(now);
    if (afterDeadline) {
      const daysUntilNextTuesday = ((9 - currentDay) % 7) || 7;
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

    if (new Date(pickupInput.value) < new Date(pickupInput.min)) {
      pickupInput.value = pickupInput.min;
    }
  }

  function hideAllDayOptions() {
    document.getElementById('tuesday-options').classList.add('hidden');
    document.getElementById('wednesday-options').classList.add('hidden');
  }

  function updatePickupOptions() {
    enforceMinPickupDate();
    const role = roleSelect.value;
    const label = document.getElementById('pickup-date-label');
    const wrapper = document.getElementById('pickup-date-wrapper');
    const day = new Date(pickupInput.value).getUTCDay();

    if (!role) {
      wrapper.classList.add('hidden');
      return;
    } else {
      wrapper.classList.remove('hidden');
    }

    hideAllDayOptions();

    if (role === "Student") {
      label.textContent = 'Pickup Date (Wednesdays only)';
      document.getElementById('radio-delivery').classList.add('hidden');

      if (day !== 3) {
        pickupInput.setCustomValidity("As a student, you may only select Wednesdays.");
        pickupInput.reportValidity();
      } else {
        pickupInput.setCustomValidity('');
        document.getElementById('wednesday-options').classList.remove('hidden');
        document.querySelector('input[name="wed-option"][value="pickup"]').checked = true;
        document.getElementById('location-wed').classList.add('hidden');
        document.getElementById('location-wed-input').value = 'Virum Festsall';
        document.getElementById('pickup-location-label').textContent = 'Virum Festsall';
      }
    } else {
      label.textContent = 'Pickup Date (Tuesdays & Wednesdays)';
      document.getElementById('radio-delivery').classList.remove('hidden');
      document.getElementById('pickup-location-label').textContent = 'Proffen Konferenz';

      if (day === 2) {
        document.getElementById('tuesday-options').classList.remove('hidden');
        pickupInput.setCustomValidity('');
      } else if (day === 3) {
        document.getElementById('wednesday-options').classList.remove('hidden');
        pickupInput.setCustomValidity('');

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

  // Bind listeners
  enforceMinPickupDate();
  hideAllDayOptions();
  pickupInput.addEventListener('input', updatePickupOptions);
  roleSelect.addEventListener('change', updatePickupOptions);

  document.querySelectorAll('input[name="wed-option"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const locWed = document.getElementById('location-wed');
      locWed.classList.toggle('hidden', radio.value !== 'delivery');
    });
  });
}
