export function enforceMinPickupDate() {
  const pickupInput = document.getElementById('pickup-date');
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const currentHour = now.getHours();

  // Orders after Wednesday 08:00 move to next week's Wednesday
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

function hideAllDayOptions() {
  document.getElementById('wednesday-options').classList.add('hidden');
  document.getElementById('thursday-options').classList.add('hidden');
  document.getElementById('friday-options').classList.add('hidden');
}

export function updatePickupOptions() {
  const pickupInput = document.getElementById('pickup-date');
  const roleSelect = document.getElementById('role');
  enforceMinPickupDate();

  const role = roleSelect.value;
  const label = document.getElementById('pickup-date-label');
  const wrapper = document.getElementById('pickup-date-wrapper');
  const day = new Date(pickupInput.value).getUTCDay(); // 3=Wed, 4=Thu, 5=Fri

  if (!role) {
    wrapper.classList.add('hidden');
    return;
  } else {
    wrapper.classList.remove('hidden');
  }

  hideAllDayOptions();

  label.textContent = 'Pickup Date (Wednesday, Thursday or Friday)';

  if (day === 3) {
    document.getElementById('wednesday-options').classList.remove('hidden');
    pickupInput.setCustomValidity('');
  } else if (day === 4) {
    document.getElementById('thursday-options').classList.remove('hidden');
    pickupInput.setCustomValidity('');
  } else if (day === 5) {
    document.getElementById('friday-options').classList.remove('hidden');
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
}
