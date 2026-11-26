// Checkout page: customer form, then the order summary from the server.

import { ApiError, submitOrder } from "./api.js";
import { cartItems, clearCart } from "./cart.js";
import { renderCartTable } from "./components/cartTable.js";
import { formatMoney } from "./format.js";
import { getState, setState } from "./state.js";

export function renderCheckout(root) {
  const items = cartItems();
  root.innerHTML = `
    <h2>Checkout</h2>
    <div id="lines"></div>
    <form id="customer">
      <label>Name <input name="name" required></label>
      <label>Postcode <input name="postcode" pattern="[0-9]{5}" required></label>
      <label>Coupon <input name="coupon"></label>
      <button type="submit" ${items.length ? "" : "disabled"}>Place order</button>
    </form>
    <p class="error"></p>`;
  root.querySelector(".error").textContent = getState().error;
  renderCartTable(root.querySelector("#lines"), items);
  root.querySelector("#customer").addEventListener("submit", (event) => {
    event.preventDefault();
    placeOrder(new FormData(event.target), items);
  });
}

async function placeOrder(form, items) {
  const order = {
    items,
    customer: { name: form.get("name"), postcode: form.get("postcode") },
    coupon: form.get("coupon") || undefined,
  };
  try {
    const summary = await submitOrder(order);
    clearCart();
    setState({ lastOrder: summary, error: "" });
    location.hash = "#/done";
  } catch (err) {
    const msg = err instanceof ApiError && err.status === 409 ? "Some items sold out." : err.message;
    setState({ error: msg });
  }
}

export function renderDone(root) {
  const s = getState().lastOrder;
  root.innerHTML = s
    ? `<h2>Thank you</h2><p>Order ${s.id}: ${formatMoney(s.total)}, tax ${formatMoney(s.tax)}.</p>`
    : "<p>No order yet.</p>";
}
