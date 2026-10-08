import { money } from "./catalog.js";
import { formatDate, fulfillmentOptions } from "./schedule.js";
const $ = (s) => document.querySelector(s),
  escapeHTML = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const roleLabel = { Student: "Élève", Teacher: "Enseignant", Other: "Autre" };
const statusLabel = {
  received: "Reçue",
  preparing: "En préparation",
  ready: "Prête",
  collected: "Retirée",
  cancelled: "Annulée",
};
const paymentLabel = { paid: "Payé", unpaid: "À payer" };
const collectionLabel = {
  library: "Devant la bibliothèque",
  staff: "Proffen Konferenz",
  fridge: "Réfrigérateur à l’extérieur du Proffenkonferenz",
  delivery: "Ancienne livraison à l’école",
};
const emailLabels = {
  sent: "E-mail envoyé",
  pending: "E-mail en attente",
  sending: "Envoi en cours",
  failed: "E-mail à renvoyer",
  review: "E-mail : vérifier l’envoi dans Resend",
};
let csrf = "",
  orders = [],
  products = [],
  toastTimer;
function error(e) {
  $("#admin-error").textContent = e.message;
  $("#admin-error").hidden = false;
}
function toast(text) {
  $("#admin-toast").textContent = text;
  $("#admin-toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => $("#admin-toast").classList.remove("visible"),
    2500,
  );
}
async function api(path, method = "GET", body) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      $("#dashboard").hidden = true;
      $("#login-panel").hidden = false;
      $("#logout").hidden = true;
    }
    throw new Error(data.error || "Une erreur est survenue.");
  }
  return data;
}
function filtered() {
  const text = $("#search").value.toLowerCase(),
    status = $("#status-filter").value;
  return orders.filter(
    (o) =>
      (status === "all" || status === "active"
        ? !["collected", "cancelled"].includes(o.status) || status === "all"
        : o.status === status) &&
      `${o.id} ${o.first_name} ${o.last_name} ${o.email}`
        .toLowerCase()
        .includes(text),
  );
}
function renderOrders() {
  const active = orders.filter(
    (o) => !["collected", "cancelled"].includes(o.status),
  );
  $("#stat-orders").textContent = active.length;
  $("#stat-smoothies").textContent = active.reduce((s, o) => s + o.quantity, 0);
  $("#stat-sales").textContent = money(
    orders
      .filter((o) => o.payment_status === "paid" && o.status !== "cancelled")
      .reduce((s, o) => s + o.total, 0),
  );
  const list = filtered();
  $("#admin-orders").innerHTML = list.length
    ? list
        .map((o) => {
          const fulfillment = fulfillmentOptions(o.role, o.date).find(
              (f) => f.id === o.fulfillment,
            ),
            next = {
              received: ["preparing", "Commencer la préparation"],
              preparing: ["ready", "Marquer comme prête"],
              ready: ["collected", "Marquer comme retirée"],
            }[o.status];
          return `<article class="admin-order"><div><p class="ref">${escapeHTML(o.id)}</p><h3>${escapeHTML(o.first_name)} ${escapeHTML(o.last_name)}</h3><p>${escapeHTML(o.email)}</p><p>${escapeHTML(roleLabel[o.role] || o.role)} · ${formatDate(o.date)}</p><p>${escapeHTML(fulfillment?.label || collectionLabel[o.fulfillment] || o.fulfillment)}${o.room ? " · " + escapeHTML(o.room) : ""}<br>${escapeHTML(fulfillment?.time || "")}</p></div><div><ul class="items-list">${o.items.map((i) => `<li>${i.qty} × ${escapeHTML(i.name)} <strong>${money(i.price * i.qty)}</strong></li>`).join("")}</ul><strong>${money(o.total)}</strong></div><div><span class="status-chip">${statusLabel[o.status]}</span><span class="status-chip ${o.payment_status}">${paymentLabel[o.payment_status]}</span><p>${escapeHTML(emailLabels[o.email_status] || "")}</p><div class="order-actions">${["pending", "failed", "sending"].includes(o.email_status) ? `<button class="button secondary" data-email="${o.id}">Réessayer l’e-mail</button>` : ""}${next ? `<button class="button primary" data-order="${o.id}" data-status="${next[0]}">${next[1]} →</button>` : ""}${o.payment_status === "unpaid" && o.status !== "cancelled" ? `<button class="button secondary" data-order="${o.id}" data-paid="true">Enregistrer le paiement</button>` : ""}${!["collected", "cancelled"].includes(o.status) ? `<button class="cancel" data-order="${o.id}" data-status="cancelled">Annuler la commande</button>` : ""}</div></div></article>`;
        })
        .join("")
    : '<div class="admin-empty"><h3>Aucune commande à afficher.</h3><p>Aucune commande ne correspond à cette sélection. Actualisez pour rechercher de nouvelles commandes.</p></div>';
}
function renderProducts() {
  $("#admin-products").innerHTML = products
    .map(
      (p) =>
        `<form class="product-edit" data-product="${p.id}" aria-label="Paramètres de ${p.name}"><h3>${p.name}</h3><label>Prix (€)<input type="number" name="price" min="0.50" max="50" step="0.01" value="${(p.price / 100).toFixed(2)}" required></label><label class="check-label"><input type="checkbox" name="available" ${p.available ? "checked" : ""}>Disponible à la commande</label><button class="button primary" type="submit">Enregistrer</button></form>`,
    )
    .join("");
}
async function refresh() {
  const [data, catalog] = await Promise.all([
    api("admin/orders"),
    api("catalog"),
  ]);
  orders = data.orders;
  products = catalog.products;
  $("#legacy-section").hidden = !catalog.legacyCompatible || data.demo;
  $("#admin-mode").textContent = data.demo
    ? "ESPACE ÉQUIPE · COMMANDES DE TEST"
    : "ESPACE ÉQUIPE · COMMANDES RÉELLES";
  renderOrders();
  renderProducts();
}
async function enter() {
  await refresh();
  $("#login-panel").hidden = true;
  $("#dashboard").hidden = false;
  $("#logout").hidden = false;
  $("#admin-error").hidden = true;
  window.scrollTo({ top: 0, behavior: "instant" });
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("admin/login", "POST", {
      password: e.target.elements.password.value,
    });
    csrf = data.csrf;
    e.target.reset();
    await enter();
  } catch (e) {
    error(e);
  } finally {
    button.disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("admin/logout", "POST", {});
    csrf = "";
    orders = [];
    $("#admin-orders").replaceChildren();
    $("#legacy-orders").replaceChildren();
    $("#dashboard").hidden = true;
    $("#login-panel").hidden = false;
    $("#logout").hidden = true;
  } catch (e) {
    error(e);
  }
});
$("#refresh").addEventListener("click", async () => {
  try {
    await refresh();
    toast("Commandes actualisées.");
  } catch (e) {
    error(e);
  }
});
$("#search").addEventListener("input", renderOrders);
$("#status-filter").addEventListener("change", renderOrders);
for (const tab of ["orders", "products"])
  $(`#${tab}-tab`).addEventListener("click", () => {
    for (const name of ["orders", "products"]) {
      $(`#${name}-panel`).hidden = name !== tab;
      $(`#${name}-tab`).classList.toggle("active", name === tab);
      $(`#${name}-tab`).setAttribute("aria-pressed", String(name === tab));
    }
  });
$("#admin-orders").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-order]");
  if (!b) return;
  if (
    b.dataset.status === "cancelled" &&
    !confirm(
      "Annuler cette commande ? Si elle a été payée, le remboursement doit être géré séparément.",
    )
  )
    return;
  if (b.dataset.paid && !confirm("Avez-vous reçu et vérifié ce paiement ?"))
    return;
  b.disabled = true;
  try {
    $("#admin-error").hidden = true;
    await api(
      `admin/orders/${b.dataset.order}`,
      "PATCH",
      b.dataset.paid ? { paymentStatus: "paid" } : { status: b.dataset.status },
    );
    await refresh();
    toast("Commande mise à jour.");
  } catch (e) {
    error(e);
  } finally {
    b.disabled = false;
  }
});
$("#admin-products").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    b = f.querySelector("button");
  b.disabled = true;
  try {
    await api(`admin/products/${f.dataset.product}`, "PATCH", {
      price: Math.round(Number(f.elements.price.value) * 100),
      available: f.elements.available.checked,
    });
    toast("Carte mise à jour.");
  } catch (e) {
    error(e);
  } finally {
    b.disabled = false;
  }
});
$("#export").addEventListener("click", () => {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const rows = [
    [
      "Référence",
      "Nom",
      "E-mail",
      "Date",
      "Profil",
      "Retrait",
      "Ancienne salle de livraison",
      "Articles",
      "Total EUR",
      "Statut",
      "Paiement",
      "Test",
    ],
    ...filtered().map((o) => [
      o.id,
      o.first_name + " " + o.last_name,
      o.email,
      o.date,
      roleLabel[o.role],
      collectionLabel[o.fulfillment],
      o.room,
      o.items.map((i) => `${i.qty} x ${i.name}`).join("; "),
      (o.total / 100).toFixed(2),
      statusLabel[o.status],
      paymentLabel[o.payment_status],
      o.demo ? "Oui" : "Non",
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "vitaminboost-commandes.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const session = await api("admin/session");
  csrf = session.csrf;
  await enter();
} catch {}

$("#admin-orders").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-email]");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await api(
      `admin/email/${encodeURIComponent(button.dataset.email)}`,
      "POST",
      {},
    );
    toast(emailLabels[result.emailStatus] || "Envoi non disponible");
    await refresh();
  } catch (e) {
    error(e);
  } finally {
    button.disabled = false;
  }
});

$("#load-legacy").addEventListener("click", async (event) => {
  event.target.disabled = true;
  try {
    const data = await api("admin/legacy-orders");
    $("#legacy-orders").innerHTML = data.orders.length
      ? data.orders
          .map((order) => {
            let items;
            try {
              const parsed = JSON.parse(order.order_items);
              items = Array.isArray(parsed)
                ? parsed.map((i) => `${i.qty} × ${i.name}`).join(" · ")
                : order.order_items;
            } catch {
              items = order.order_items;
            }
            return `<article class="admin-order"><div><p class="ref">${escapeHTML(order.order_number)}</p><h3>${escapeHTML(order.name || "")}</h3><p>${escapeHTML(order.email || "")}</p><p>${escapeHTML(order.pickup_date || "")} · ${escapeHTML(order.delivery_location || "")}</p></div><div><p>${escapeHTML(items || "")}</p><strong>${escapeHTML(order.total_amount || "")} €</strong></div></article>`;
          })
          .join("")
      : "<p>Aucune ancienne commande à afficher.</p>";
  } catch (e) {
    error(e);
  } finally {
    event.target.disabled = false;
  }
});
