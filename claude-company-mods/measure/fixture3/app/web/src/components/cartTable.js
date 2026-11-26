// Cart lines as a table with a remove button per line.

import { removeFromCart } from "../cart.js";
import { formatMoney } from "../format.js";
import { getState } from "../state.js";

export function renderCartTable(el, items) {
  if (!items.length) {
    el.innerHTML = "<p>Your cart is empty.</p>";
    return;
  }
  const bySku = new Map(getState().products.map((p) => [p.sku, p]));
  const rows = items.map(({ sku, qty }) => {
    const p = bySku.get(sku);
    const price = p ? formatMoney(p.price) : "?";
    return `<tr><td>${p ? p.name : sku}</td><td>${qty}</td><td>${price}</td><td><button data-sku="${sku}">Remove</button></td></tr>`;
  });
  el.innerHTML = `<table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  for (const b of el.querySelectorAll("button[data-sku]")) {
    b.addEventListener("click", () => removeFromCart(b.dataset.sku));
  }
}
