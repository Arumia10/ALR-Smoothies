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

function setDisplay(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.display = value;
}

function hideAllDayOptions() {
  hideById('wednesday-options');
  hideById('thursday-options');
  hideById('friday-options');
}

function configureWednesdayOptionsForStudent() {
  setDisplay('radio-pickup', 'none');
  setDisplay('radio-delivery', 'none');
  setDisplay('radio-fridge', 'none');
  setDisplay('radio-student-pickup', 'block');

  const locationWed = document.getElementById('location-wed');
  if (locationWed) locationWed.classList.add('hidden');

  const studentRadio = document.querySelector('input[name="wed-option"][value="student-pickup"]');
  if (studentRadio) studentRadio.checked = true;
}

function configureWednesdayOptionsForTeacherOther() {
  setDisplay('radio-pickup', 'block');
  setDisplay('radio-delivery', 'block');
  setDisplay('radio-fridge', 'block');
  setDisplay('radio-student-pickup', 'none');

  const checked = document.querySelector('input[name="wed-option"]:checked');
  if (!checked || checked.value === 'student-pickup') {
    const fridgeRadio = document.querySelector('input[name="wed-option"][value="fridge"]');
    if (fridgeRadio) fridgeRadio.checked = true;
  }

  const selected = document.querySelector('input[name="wed-option"]:checked')?.value;
  const locationWed = document.getElementById('location-wed');
  if (locationWed) {
    locationWed.classList.toggle('hidden', selected !== 'delivery');
  }
}

export function updatePickupOptions() {
  const pickupInput = document.getElementById('pickup-date');
  const roleSelect = document.getElementById('role');
  const label = document.getElementById('pickup-date-label');
  const wrapper = document.getElementById('pickup-date-wrapper');

  enforceMinPickupDate();

  const role = roleSelect.value;
  const day = new Date(pickupInput.value).getUTCDay();

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
      configureWednesdayOptionsForStudent();
      pickupInput.setCustomValidity('');
    } else {
      pickupInput.setCustomValidity('As a student, you may only select Wednesday.');
      pickupInput.reportValidity();
    }

    return;
  }

  label.textContent = 'Pickup Date (Wednesday, Thursday or Friday)';

  if (day === 3) {
    showById('wednesday-options');
    configureWednesdayOptionsForTeacherOther();
    pickupInput.setCustomValidity('');
  } else if (day === 4) {
    showById('thursday-options');
    pickupInput.setCustomValidity('');
  } else if (day === 5) {
    showById('friday-options');
    pickupInput.setCustomValidity('');
  } else {
    pickupInput.setCustomValidity('Please choose a Wednesday, Thursday or Friday');
    pickupInput.reportValidity();
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
      const role = document.getElementById('role').value;
      if (role !== 'Student') {
        configureWednesdayOptionsForTeacherOther();
      }
    });
  });
}
