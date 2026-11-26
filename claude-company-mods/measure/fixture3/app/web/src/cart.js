// Cart operations on the store. The cart maps sku -> qty.

import { getState, setState } from "./state.js";

export function addToCart(sku, qty = 1) {
  const cart = { ...getState().cart };
  cart[sku] = (cart[sku] || 0) + qty;
  setState({ cart });
}

export function removeFromCart(sku) {
  const cart = { ...getState().cart };
  delete cart[sku];
  setState({ cart });
}

export function cartItems() {
  return Object.entries(getState().cart).map(([sku, qty]) => ({ sku, qty }));
}

export function cartCount() {
  return cartItems().reduce((n, item) => n + item.qty, 0);
}

export function clearCart() {
  setState({ cart: {} });
}
