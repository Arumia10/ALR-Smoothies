const SMOOTHIES = [
  {
    id: "red-berries",
    name: "Red Berries",
    ingredients: "Fraise, framboise, dattes",
    category: "berries",
    note: "Le classique aux fruits rouges",
    color: "pink",
    image: "Red Berries.png",
  },
  {
    id: "ruby-boost",
    name: "Ruby Boost",
    ingredients: "Framboise, grenade, dattes",
    category: "berries",
    note: "Une pause haute en couleur",
    color: "pink",
    image: "Ruby Boost.png",
  },
  {
    id: "cherry-berry",
    name: "Cherry Berry",
    ingredients: "Framboise, cerise, dattes",
    category: "berries",
    note: "La cerise à l’honneur",
    color: "purple",
    image: "Cherry Berry.png",
  },
  {
    id: "raspberry-sunset",
    name: "Raspberry Sunset",
    ingredients: "Framboise, mangue, dattes",
    category: "tropical",
    note: "Un petit goût de soleil",
    color: "peach",
    image: "Raspberry Sunset.png",
  },
  {
    id: "mango-blush",
    name: "Mango Blush",
    ingredients: "Fraise, mangue, dattes",
    category: "tropical",
    note: "La douceur rencontre les tropiques",
    color: "peach",
    image: "Mango Blush.png",
  },
  {
    id: "golden-sunrise",
    name: "Golden Sunrise",
    ingredients: "Orange, ananas, mangue",
    category: "tropical",
    note: "Un rayon de soleil à savourer",
    color: "yellow",
    image: "Golden Sunrise.png",
  },
  {
    id: "tropical-fire",
    name: "Tropical Fire",
    ingredients: "Orange, ananas, mangue, gingembre, fruit de la passion",
    category: "tropical",
    note: "Les tropiques avec du caractère",
    color: "yellow",
    image: "Tropical Fire.png",
  },
  {
    id: "green-refresh",
    name: "Green Refresh",
    ingredients: "Ananas, chou kale, dattes, menthe",
    category: "greens",
    note: "Une touche de fraîcheur",
    color: "green",
    image: "Green Refresh.png",
  },
].map((p) => ({
  ...p,
  price: 350,
  size: 330,
  portion: "330 ml",
  preparation: "Mixé sous vide",
  available: p.id !== "cherry-berry",
}));

// Recipes and price from the poster supplied by the owner on 4 October 2026.
// No volume was provided: jars are sold as one pot, without a guessed size.
export const BREAKFAST_JARS = [
  {
    id: "berry-dream",
    name: "Berry Dream",
    ingredients:
      "Fraises, granola maison, yaourt au soja, pudding de chia à la vanille, coulis de framboise et dattes",
    category: "breakfast",
    note: "La douceur de la vanille et des fruits rouges",
    color: "breakfast",
    image: "berry-dream.png",
    price: 450,
    portion: "1 pot",
    preparation: "",
    available: true,
  },
  {
    id: "matcha-dream",
    name: "Matcha Dream",
    ingredients:
      "Fraises, granola maison, yaourt au soja, pudding de chia au matcha, coulis de framboise et dattes",
    category: "breakfast",
    note: "Une pause gourmande aux notes de matcha",
    color: "breakfast",
    image: "matcha-dream-smooth-lid.png",
    price: 450,
    portion: "1 pot",
    preparation: "",
    available: true,
  },
];
export const PRODUCTS = [...SMOOTHIES, ...BREAKFAST_JARS];
export const money = (cents) =>
  new Intl.NumberFormat("fr-LU", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export function cleanCart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    PRODUCTS.filter(
      (p) => Number.isInteger(value[p.id]) && value[p.id] > 0,
    ).map((p) => [p.id, Math.min(value[p.id], 20)]),
  );
}
