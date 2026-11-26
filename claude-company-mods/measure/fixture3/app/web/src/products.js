// Product list page.

import { getProducts } from "./api.js";
import { addToCart } from "./cart.js";
import { productCard } from "./components/productCard.js";
import { getState, setState } from "./state.js";

export async function loadProducts() {
  try {
    setState({ products: await getProducts(), error: "" });
  } catch (err) {
    setState({ error: err.message });
  }
}

export function renderProducts(root) {
  const { products } = getState();
  root.innerHTML = "<h2>Teas and tools</h2><ul class=\"grid\"></ul>";
  const list = root.querySelector("ul");
  for (const p of products) list.appendChild(productCard(p, () => addToCart(p.sku)));
}
