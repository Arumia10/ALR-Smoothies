import { PRODUCTS, money, cleanCart } from "./catalog.js";
import { availableDates, fulfillmentOptions, formatDate } from "./schedule.js";
const $ = (s) => document.querySelector(s);
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let products = PRODUCTS,
  cart = {},
  filter = "all",
  service = null,
  orderKey = null,
  orderSnapshot = null,
  submitting = false,
  toastTimer;
try {
  cart = cleanCart(
    JSON.parse(localStorage.getItem("vitaminboost-bag") || "{}"),
  );
} catch {}
const bag = $("#bag-dialog"),
  checkout = $("#checkout-dialog"),
  form = $("#checkout-form");
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}
function cartLines() {
  return products
    .filter((p) => cart[p.id])
    .map((p) => ({ ...p, qty: cart[p.id] }));
}
const total = () => cartLines().reduce((sum, p) => sum + p.price * p.qty, 0);
function persist() {
  try {
    localStorage.setItem("vitaminboost-bag", JSON.stringify(cart));
  } catch {}
  orderKey = null;
  orderSnapshot = null;
  renderBag();
}
function productImage(p, thumbnail = false) {
  const alt = thumbnail ? "" : escapeHTML(p.ingredients);
  return `<img src="assets/${encodeURIComponent(p.image)}" alt="${alt}" width="${p.category === "breakfast" ? 1024 : 2362}" height="${p.category === "breakfast" ? 1024 : 1273}" loading="lazy">`;
}
function renderProducts() {
  $("#product-count").textContent = products.length;
  $("#breakfast-filter").hidden = !products.some(
    (p) => p.category === "breakfast",
  );
  $("#product-grid").innerHTML = products
    .filter((p) => filter === "all" || p.category === filter)
    .map(
      (p) =>
        `<article class="product-card"><div class="product-art ${p.color}"><span class="product-tag">${p.category === "breakfast" ? "Petit-déjeuner" : p.category === "berries" ? "Fruits rouges" : p.category === "greens" ? "Tout vert" : "Tropical"}</span>${productImage(p)}</div><div class="product-body"><p class="product-note">${p.note}</p><h3>${p.name}</h3><p class="ingredients">${p.ingredients}</p><div class="product-bottom"><div class="price">${money(p.price)}<small>${escapeHTML(p.portion)}${p.preparation ? " · " + escapeHTML(p.preparation) : ""}</small></div><button class="add-button" data-add="${p.id}" aria-label="Ajouter ${p.name} au panier" ${!p.available ? "disabled" : ""}>${p.available ? "+" : "–"}</button></div>${!p.available ? '<p class="form-note">Momentanément indisponible</p>' : ""}</div></article>`,
    )
    .join("");
}
function renderBag() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  $("#cart-count").textContent = count;
  $("#open-cart").setAttribute(
    "aria-label",
    `Ouvrir le panier, ${count} article${count === 1 ? "" : "s"}`,
  );
  $("#bag-items").innerHTML = cartLines().length
    ? cartLines()
        .map(
          (p) =>
            `<div class="bag-item">${productImage(p, true)}<div><h3>${p.name}</h3><p>${escapeHTML(p.portion)} · ${money(p.price)} l’unité</p><div class="quantity"><button data-qty="${p.id}" data-change="-1" aria-label="Retirer un ${p.name}">−</button><span aria-label="Quantité">${p.qty}</span><button data-qty="${p.id}" data-change="1" aria-label="Ajouter un ${p.name}" ${p.qty >= 20 ? "disabled" : ""}>+</button></div></div><div class="bag-item-total"><strong>${money(p.price * p.qty)}</strong><br><button class="remove-item" data-remove="${p.id}" aria-label="Retirer tous les ${p.name}">Retirer</button></div></div>`,
        )
        .join("")
    : '<div class="empty-bag"><span aria-hidden="true">✳</span><h3>Votre panier attend<br>vos envies.</h3><p>Votre prochaine pause préférée vous attend sur la carte.</p><button class="button primary" id="empty-explore">Découvrir la carte ↗</button></div>';
  $("#bag-dock").hidden = count === 0;
  $("#dock-summary").textContent =
    `${count} article${count === 1 ? "" : "s"} · ${money(total())}`;
  $("#bag-total").textContent = money(total());
  $("#checkout-open").disabled = count === 0;
}
function updateDates() {
  const current = $("#pickup-date").value;
  const dates =
    service?.dates?.[$("#role").value] || availableDates($("#role").value);
  $("#pickup-date").innerHTML = dates
    .map((d) => `<option value="${d}">${formatDate(d)}</option>`)
    .join("");
  if (dates.includes(current)) $("#pickup-date").value = current;
  updateFulfillment();
}
function updateFulfillment() {
  const current = form.elements.fulfillment?.value;
  const options = fulfillmentOptions($("#role").value, $("#pickup-date").value);
  $("#fulfillment-options").innerHTML = options
    .map(
      (o, i) =>
        `<label class="pickup-choice"><input type="radio" name="fulfillment" value="${o.id}" ${options.some((v) => v.id === current) ? (o.id === current ? "checked" : "") : i === 0 ? "checked" : ""} required><span>${o.label}<small>${o.time}</small></span></label>`,
    )
    .join("");
}

function details() {
  const data = new FormData(form);
  return {
    firstName: data.get("firstName").trim(),
    lastName: data.get("lastName").trim(),
    email: data.get("email").trim(),
    role: data.get("role"),
    date: data.get("date"),
    fulfillment: data.get("fulfillment"),
    room: "",
    website: data.get("website"),
    items: cartLines().map((p) => ({ id: p.id, qty: p.qty })),
    expectedTotal: total(),
  };
}
function fulfillmentText(data) {
  const option = fulfillmentOptions(data.role, data.date).find(
    (o) => o.id === data.fulfillment,
  );
  return `${option?.label || ""}${data.room ? " · " + data.room : ""} · ${option?.time || ""}`;
}
function renderReview(data) {
  $("#review-summary").innerHTML =
    `<h3>Le récapitulatif de votre pause.</h3>${cartLines()
      .map(
        (p) =>
          `<div class="review-line"><span>${p.qty} × ${p.name}</span><strong>${money(p.qty * p.price)}</strong></div>`,
      )
      .join(
        "",
      )}<hr><div class="total-row"><span>Total</span><strong>${money(total())}</strong></div><p>Retrait à l’école sans frais supplémentaires.</p><hr><h3>${escapeHTML(data.firstName)} ${escapeHTML(data.lastName)}</h3><p>${escapeHTML(data.email)}</p><p><strong>${formatDate(data.date)}</strong></p><p>${escapeHTML(fulfillmentText(data))}</p>`;
}
function openCheckout() {
  bag.close();
  form.reset();
  $("#details-step").hidden = false;
  $("#review-step").hidden = true;
  $("#order-success").hidden = true;
  form.hidden = false;
  $(".checkout-steps").hidden = false;
  $("#step-one").classList.add("active");
  $("#step-two").classList.remove("active");
  $("#order-error").hidden = true;
  updateDates();
  checkout.showModal();
}
function showDetails() {
  if (submitting) return;
  $("#details-step").hidden = false;
  $("#review-step").hidden = true;
  $("#step-one").classList.add("active");
  $("#step-two").classList.remove("active");
  form.elements.firstName.focus();
}
let turnstileToken = "",
  turnstileWidget = null,
  turnstileLoading = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileLoading) return turnstileLoading;
  turnstileLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error("timeout"));
    }, 12000);
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) window.turnstile.ready(resolve);
      else reject(new Error("unavailable"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("unavailable"));
    };
    document.head.append(script);
  }).catch((error) => {
    turnstileLoading = null;
    throw error;
  });
  return turnstileLoading;
}
async function prepareTurnstile() {
  if (!service?.turnstileSiteKey) return;
  $("#security-check").hidden = false;
  $("#security-message").textContent = "Vérification de sécurité…";
  turnstileToken = "";
  resetSubmit();
  try {
    await loadTurnstile();
    if (turnstileWidget !== null) window.turnstile.remove(turnstileWidget);
    turnstileWidget = window.turnstile.render("#turnstile-widget", {
      sitekey: service.turnstileSiteKey,
      action: "order",
      language: "fr",
      size: "flexible",
      callback: (token) => {
        turnstileToken = token;
        $("#security-message").textContent = "Vérification effectuée.";
        if (!submitting) resetSubmit();
      },
      "expired-callback": () => {
        turnstileToken = "";
        $("#security-message").textContent =
          "La vérification a expiré. Relancez-la avant de valider.";
        if (!submitting) resetSubmit();
      },
      "error-callback": () => {
        turnstileToken = "";
        $("#security-message").textContent =
          "Vérification indisponible. Vérifiez votre connexion et réessayez.";
        if (!submitting) resetSubmit();
      },
    });
  } catch {
    $("#security-message").textContent =
      "Vérification indisponible. Autorisez Cloudflare Turnstile dans votre navigateur puis réessayez.";
  }
}
$("#security-retry").addEventListener("click", () => {
  if (!submitting) prepareTurnstile();
});
function resetSubmit() {
  submitting = false;
  $("#place-order").disabled = Boolean(
    service?.turnstileSiteKey && !turnstileToken,
  );
  $("#place-order").textContent =
    service?.demo === false
      ? "Valider la commande →"
      : "Valider la commande de test →";
}
async function submitOrder() {
  if (submitting) return;
  const error = $("#order-error");
  error.hidden = true;
  if (!$("#review-consent").checked) {
    error.textContent =
      "Veuillez vérifier votre commande et vos informations de retrait.";
    error.hidden = false;
    return;
  }
  if (!service) {
    error.textContent =
      "Le service de commande est indisponible. Votre panier est conservé. Veuillez réessayer lorsque le service sera disponible.";
    error.hidden = false;
    return;
  }
  if (service.turnstileSiteKey && !turnstileToken) {
    error.textContent = "Veuillez terminer la vérification de sécurité.";
    error.hidden = false;
    return;
  }
  const data = details(),
    snapshot = JSON.stringify(data);
  if (orderSnapshot !== snapshot) {
    orderKey = crypto.randomUUID();
    orderSnapshot = snapshot;
  }
  submitting = true;
  $("#place-order").disabled = true;
  $("#place-order").textContent = "Enregistrement de votre commande…";
  try {
    const response = await fetch("api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": orderKey,
      },
      body: JSON.stringify({
        ...data,
        ...(service.turnstileSiteKey ? { cf_token: turnstileToken } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error ||
          "Votre commande n’a pas pu être enregistrée. Veuillez réessayer.",
      );
    form.hidden = true;
    $(".checkout-steps").hidden = true;
    $("#order-success").innerHTML =
      `<span class="success-symbol" aria-hidden="true">✓</span><h3>${result.demo ? "Votre test est enregistré." : "Votre commande est enregistrée."}</h3><p>${result.demo ? "Il s’agit d’une commande de test. Aucun paiement n’a été effectué et aucun produit ne sera préparé." : "Votre commande a été enregistrée. Le paiement s’effectue au retrait."}</p><div class="review-summary"><div class="review-line"><span>Référence de commande</span><strong>${escapeHTML(result.reference)}</strong></div><div class="review-line"><span>Total</span><strong>${money(result.total)}</strong></div><hr><p><strong>${formatDate(result.date)}</strong></p><p>${escapeHTML(fulfillmentText(data))}</p></div><p>Conservez votre référence pour le retrait.</p><section class="jar-return" aria-labelledby="jar-return-title"><h4 id="jar-return-title">Rapportez vos bocaux</h4><p>Après votre smoothie ou votre breakfast jar, rincez brièvement le bocal et son couvercle. Déposez-les ensuite dans les bacs verts à côté du réfrigérateur, à l’extérieur du Proffenkonferenz.</p><img src="assets/retour-bocaux.jpg" alt="Le bac vert où déposer les bocaux et leurs couvercles après les avoir rincés" width="3678" height="2856" loading="lazy"></section><button class="button primary full" id="finish-order">Retour à la carte <span aria-hidden="true">↗</span></button>`;
    if (!result.demo) {
      const payment = document.createElement("details");
      payment.innerHTML =
        '<summary>Payer avec Wero au retrait</summary><p>Scannez ce code et indiquez le total de votre commande. Le paiement sera vérifié par l’équipe.</p><img class="wero-qr" src="assets/wero-qr.png" width="670" height="807" alt="QR code Wero de VitaminBoost">';
      $("#order-success").append(payment);
    }
    if (!result.demo && result.emailStatus) {
      const message = document.createElement("p");
      message.textContent =
        result.emailStatus === "sent"
          ? "L’e-mail de confirmation a été envoyé. Pensez à vérifier vos courriers indésirables."
          : "Votre commande est bien enregistrée, mais l’envoi de l’e-mail n’est pas confirmé. Conservez votre référence ; inutile de repasser commande.";
      $("#order-success").prepend(message);
    }
    $("#order-success").hidden = false;
    $("#order-success").focus();
    cart = {};
    persist();
    form.reset();
  } catch (e) {
    error.textContent =
      e.name === "TimeoutError"
        ? "Le délai de connexion a été dépassé. Réessayez avec les mêmes informations : votre commande ne sera pas créée en double."
        : e.name === "TypeError"
          ? "Connexion impossible. Vérifiez votre connexion et réessayez."
          : e.message;
    error.hidden = false;
    if (service?.turnstileSiteKey) {
      turnstileToken = "";
      if (turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
    }
  } finally {
    resetSubmit();
  }
}
$(".filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  filter = b.dataset.filter;
  document.querySelectorAll(".filter").forEach((f) => {
    f.classList.toggle("active", f === b);
    f.setAttribute("aria-pressed", String(f === b));
  });
  renderProducts();
});
$("#product-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  const p = products.find((p) => p.id === b.dataset.add);
  if (!p?.available) return;
  if ((cart[p.id] || 0) >= 20)
    return notify("Maximum 20 unités de chaque produit par commande.");
  if (Object.values(cart).reduce((a, b) => a + b, 0) >= 40)
    return notify(
      "Maximum 40 articles par commande. Contactez-nous pour une commande plus importante.",
    );
  cart[p.id] = (cart[p.id] || 0) + 1;
  persist();
  notify(`${p.name} ajouté au panier`);
  b.textContent = "✓";
  setTimeout(() => {
    b.textContent = "+";
  }, 1000);
});
$("#bag-items").addEventListener("click", (e) => {
  const qty = e.target.closest("[data-qty]"),
    remove = e.target.closest("[data-remove]");
  if (qty) {
    if (
      Number(qty.dataset.change) > 0 &&
      Object.values(cart).reduce((a, b) => a + b, 0) >= 40
    )
      return notify("Maximum 40 articles par commande.");
    const id = qty.dataset.qty;
    cart[id] = Math.max(
      0,
      Math.min(20, (cart[id] || 0) + Number(qty.dataset.change)),
    );
    if (!cart[id]) delete cart[id];
    persist();
    const same = $("#bag-items").querySelector(
      `[data-qty="${id}"][data-change="${qty.dataset.change}"]`,
    );
    same?.focus();
  }
  if (remove) {
    delete cart[remove.dataset.remove];
    persist();
  }
  if (e.target.closest("#empty-explore")) {
    bag.close();
    location.hash = "menu";
  }
});
for (const id of ["#open-cart", "#bag-dock"])
  $(id).addEventListener("click", () => {
    renderBag();
    bag.showModal();
  });
$("#checkout-open").addEventListener("click", openCheckout);
$("#role").addEventListener("change", updateDates);
$("#pickup-date").addEventListener("change", updateFulfillment);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  renderReview(details());
  $("#details-step").hidden = true;
  $("#review-step").hidden = false;
  $("#review-consent").checked = false;
  $("#step-one").classList.remove("active");
  $("#step-two").classList.add("active");
  $("#review-consent").focus({ preventScroll: true });
  checkout.scrollTop = 0;
  prepareTurnstile();
});
$("#back-details").addEventListener("click", showDetails);
$("#place-order").addEventListener("click", submitOrder);
document.addEventListener("click", (e) => {
  if (e.target.closest(".close-dialog")) {
    const d = e.target.closest("dialog");
    if (d === checkout && submitting) return;
    d.close();
  }
  if (e.target.closest("#finish-order")) checkout.close();
  if (e.target.closest("#privacy-open,.privacy-inline"))
    $("#privacy-dialog").showModal();
});
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (
      (e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom) &&
      !(d === checkout && submitting)
    )
      d.close();
  });
});
checkout.addEventListener("cancel", (e) => {
  if (submitting) e.preventDefault();
});
window.addEventListener("storage", (e) => {
  if (e.key === "vitaminboost-bag" && !checkout.open) {
    try {
      cart = cleanCart(JSON.parse(e.newValue));
      renderBag();
    } catch {}
  }
});
renderProducts();
renderBag();
async function connect() {
  try {
    const response = await fetch("api/catalog", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
    service = await response.json();
    products = service.products;
    const prices = products
        .filter((p) => p.category !== "breakfast")
        .map((p) => p.price),
      same = prices.every((p) => p === prices[0]),
      lowest = Math.min(...prices);
    $("#hero-price").textContent =
      `${same ? "" : "À partir de "}${money(lowest)} le verre`;
    $("#menu-price").textContent =
      `Smoothies · 330 ml · ${same ? "" : "à partir de "}${money(lowest)}`;
    const jarPrices = products
      .filter((p) => p.category === "breakfast")
      .map((p) => p.price);
    $("#jar-price").hidden = jarPrices.length === 0;
    if (jarPrices.length)
      $("#jar-price").textContent =
        `Pots petit-déjeuner · ${jarPrices.every((p) => p === jarPrices[0]) ? "" : "à partir de "}${money(Math.min(...jarPrices))}`;
    renderProducts();
    renderBag();
    if (!service.demo) {
      $("#privacy-preview").hidden = true;
      $("#wero-preview-note").hidden = true;
      $("#preview-indicator").hidden = true;
      $("#payment-title").textContent = "Paiement au retrait";
      $("#payment-copy").textContent =
        "Votre commande est réservée. Le paiement s’effectue au retrait ; aucun paiement n’est validé en ligne.";
      resetSubmit();
    }
    if (!service.orderingOpen) {
      $("#preview-indicator").textContent =
        "Les commandes sont actuellement suspendues";
      $("#preview-indicator").hidden = false;
    }
  } catch {
    $("#preview-indicator").textContent =
      "Aperçu de la carte · service de commande indisponible";
  }
}
connect();
