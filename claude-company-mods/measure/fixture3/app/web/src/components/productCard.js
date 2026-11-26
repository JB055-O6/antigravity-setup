// One product tile with an "Add" button.

import { formatMoney } from "../format.js";

export function productCard(product, onAdd) {
  const li = document.createElement("li");
  li.className = "card";
  li.innerHTML = `<h3></h3><p class="price">${formatMoney(product.price)}</p><button>Add</button>`;
  li.querySelector("h3").textContent = product.name;
  li.querySelector("button").addEventListener("click", onAdd);
  return li;
}
