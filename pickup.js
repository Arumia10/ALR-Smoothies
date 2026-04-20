export function enforceMinPickupDate() {
  const pickupInput = document.getElementById('pickup-date');
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

  if (pickupInput.value && new Date(pickupInput.value) < new Date(pickupInput.min)) {
    pickupInput.value = pickupInput.min;
  }
}

function hideById(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showById(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideAllDayOptions() {
  hideById('wednesday-options');
  hideById('thursday-options');
  hideById('friday-options');
}

export function updatePickupOptions() {
  const pickupInput = document.getElementById('pickup-date');
  const roleSelect = document.getElementById('role');
  const label = document.getElementById('pickup-date-label');
  const wrapper = document.getElementById('pickup-date-wrapper');
  const locationWed = document.getElementById('location-wed');

  enforceMinPickupDate();

  const role = roleSelect.value;
  const day = new Date(pickupInput.value).getUTCDay(); // 3=Wed, 4=Thu, 5=Fri

  if (!role) {
    wrapper.classList.add('hidden');
    return;
  }

  wrapper.classList.remove('hidden');
  hideAllDayOptions();

  if (role === 'Student') {
    label.textContent = 'Pickup Date (Wednesday only)';

    if (day === 3) {
      showById('wednesday-options');
      pickupInput.setCustomValidity('');

      hideById('radio-pickup');
      hideById('radio-delivery');
      hideById('radio-fridge');
      showById('radio-student-pickup');

      if (locationWed) locationWed.classList.add('hidden');

      const studentRadio = document.querySelector('input[name="wed-option"][value="student-pickup"]');
      if (studentRadio) studentRadio.checked = true;
    } else {
      pickupInput.setCustomValidity('As a student, you may only select Wednesday.');
      pickupInput.reportValidity();
    }

    return;
  }

  label.textContent = 'Pickup Date (Wednesday, Thursday or Friday)';

  if (day === 3) {
    showById('wednesday-options');
    pickupInput.setCustomValidity('');

    showById('radio-pickup');
    showById('radio-delivery');
    showById('radio-fridge');
    hideById('radio-student-pickup');

    const checked = document.querySelector('input[name="wed-option"]:checked');
    if (!checked) {
      const fridgeRadio = document.querySelector('input[name="wed-option"][value="fridge"]');
      if (fridgeRadio) fridgeRadio.checked = true;
    }

    const selected = document.querySelector('input[name="wed-option"]:checked')?.value;
    if (locationWed) locationWed.classList.toggle('hidden', selected !== 'delivery');
  } else if (day === 4) {
    showById('thursday-options');
    pickupInput.setCustomValidity('');
    if (locationWed) locationWed.classList.add('hidden');
  } else if (day === 5) {
    showById('friday-options');
    pickupInput.setCustomValidity('');
    if (locationWed) locationWed.classList.add('hidden');
  } else {
    pickupInput.setCustomValidity('Please choose a Wednesday, Thursday or Friday');
    pickupInput.reportValidity();
    if (locationWed) locationWed.classList.add('hidden');
  }
}

export function setupPickupLogic() {
  const pickupInput = document.getElementById('pickup-date');
  const roleSelect = document.getElementById('role');

  enforceMinPickupDate();
  hideAllDayOptions();

  pickupInput.addEventListener('input', updatePickupOptions);
  roleSelect.addEventListener('change', updatePickupOptions);

  document.querySelectorAll('input[name="wed-option"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const locWed = document.getElementById('location-wed');
      if (locWed) {
        locWed.classList.toggle('hidden', radio.value !== 'delivery');
      }
    });
  });
}
