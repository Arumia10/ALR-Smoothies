import { PRODUCTS } from "../public/catalog.js";
import {
  availableDates,
  fulfillmentOptions,
  COLLECTION_WEEKDAY,
} from "../public/schedule.js";
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateOrder(
  input,
  menu,
  { now = new Date(), closedDates = [] } = {},
) {
  if (input.website)
    throw new AppError("La commande n’a pas pu être acceptée.");
  const text = (field, max) => {
    const v = input[field];
    if (
      typeof v !== "string" ||
      !v.trim() ||
      v.trim().length > max ||
      /[\u0000-\u001f\u007f]/.test(v)
    )
      throw new AppError(
        `Veuillez vérifier le champ « ${{ firstName: "prénom", lastName: "nom", email: "adresse e-mail" }[field] || field} ».`,
      );
    return v.trim();
  };
  const first = text("firstName", 60),
    last = text("lastName", 60),
    email = text("email", 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AppError("Veuillez saisir une adresse e-mail valide.");
  if (!["Student", "Teacher", "Other"].includes(input.role))
    throw new AppError("Veuillez choisir votre profil à l’école.");
  if (
    !availableDates(input.role, now).includes(input.date) ||
    closedDates.includes(input.date)
  )
    throw new AppError(
      "Cette date de retrait n’est plus disponible. Actualisez la page pour en choisir une autre.",
    );
  if (
    !fulfillmentOptions(input.role, input.date).some(
      (o) => o.id === input.fulfillment,
    )
  )
    throw new AppError("Veuillez choisir un mode de retrait valide.");
  const room = "";
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > PRODUCTS.length
  )
    throw new AppError("Veuillez ajouter un article à votre panier.");
  const seen = new Set();
  let total = 0,
    quantity = 0;
  const items = input.items.map((item) => {
    if (!item || typeof item !== "object")
      throw new AppError("Veuillez vérifier votre panier.");
    const p = menu.find((p) => p.id === item.id);
    if (!p || !p.available)
      throw new AppError(
        "Un article de votre panier est indisponible. Actualisez la carte et modifiez votre panier.",
        409,
      );
    if (
      seen.has(p.id) ||
      !Number.isInteger(item.qty) ||
      item.qty < 1 ||
      item.qty > 20
    )
      throw new AppError(
        "Veuillez choisir entre 1 et 20 unités de chaque produit.",
      );
    seen.add(p.id);
    total += p.price * item.qty;
    quantity += item.qty;
    return {
      id: p.id,
      name: p.name,
      ingredients: p.ingredients,
      price: p.price,
      qty: item.qty,
    };
  });
  if (quantity > 40)
    throw new AppError(
      "Contactez notre équipe pour une commande de plus de 40 articles.",
    );
  if (!Number.isInteger(input.expectedTotal) || input.expectedTotal !== total)
    throw new AppError(
      "Le prix a changé. Actualisez la page et vérifiez votre panier avant de commander.",
      409,
    );

  return { first, last, email, room, items, total, quantity };
}
export function productionWeek(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() - COLLECTION_WEEKDAY));
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 2);
  return [start, d.toISOString().slice(0, 10)];
}
