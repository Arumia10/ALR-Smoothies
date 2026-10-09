export const TIMEZONE = "Europe/Luxembourg";
export const COLLECTION_WEEKDAY = 1;
export function localParts(now = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("fr-LU", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
}
export function availableDates(role, now = new Date()) {
  const p = localParts(now),
    today = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`),
    weekday = today.getUTCDay();
  let delta = (COLLECTION_WEEKDAY - weekday + 7) % 7;
  if (weekday === COLLECTION_WEEKDAY && Number(p.hour) >= 8) delta = 7;
  const next = new Date(today);
  next.setUTCDate(today.getUTCDate() + delta);
  const dates = [];
  for (let week = 0; week < 3; week++)
    for (let offset = 0; offset < (role === "Student" ? 1 : 2); offset++) {
      const date = new Date(next);
      date.setUTCDate(next.getUTCDate() + week * 7 + offset);
      dates.push(date.toISOString().slice(0, 10));
    }
  return dates;
}
export const STAFF_DELIVERY_LOCATIONS = [
  { id: "direction", label: "Direction" },
  { id: "student-office", label: "Secrétariat élèves" },
  { id: "teacher-office", label: "Secrétariat professeurs" },
  { id: "sepas", label: "SePAS" },
  { id: "loge", label: "Loge" },
  { id: "other", label: "Autre" },
];
export function deliveryDestination(role, department, room = "") {
  if (role === "Other" && department !== "other")
    return STAFF_DELIVERY_LOCATIONS.find(item => item.id === department)?.label || "";
  return typeof room === "string" ? room.trim() : "";
}
export function fulfillmentOptions(role, date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (role === "Student")
    return day === COLLECTION_WEEKDAY
      ? [
          {
            id: "library",
            label: "Devant la bibliothèque",
            time: "Lundi · 09 h 30",
          },
        ]
      : [];
  return ["Teacher", "Other"].includes(role) && [1, 2].includes(day)
    ? [
        {
          id: "staff",
          label: "Proffen Konferenz",
          time: "Lundi · 09 h 30 à 09 h 45",
        },
        {
          id: "fridge",
          label: "Réfrigérateur à l’extérieur du Proffenkonferenz",
          time: "Pendant les heures d’ouverture de l’école",
        },
        {
          id: "delivery",
          label: "Livraison à l’école",
          time: "Lundi",
        },
      ].filter((option) => day === 1 || option.id === "fridge")
    : [];
}
export const formatDate = (date) =>
  new Intl.DateTimeFormat("fr-LU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
