// Header with the cart count.

import { cartCount } from "../cart.js";
import { plural } from "../format.js";

export function renderHeader(el) {
  el.innerHTML = `<a href="#/">Tea shop</a> <a href="#/checkout">Cart (${plural(cartCount(), "item")})</a>`;
}
