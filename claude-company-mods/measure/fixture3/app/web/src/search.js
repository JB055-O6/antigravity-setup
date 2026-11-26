// Search box. Waits for a pause in typing before it asks the server.

import { searchProducts } from "./api.js";
import { setState } from "./state.js";

const WAIT_MS = 250;
let timer = null;

export function bindSearch(input) {
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value.trim()), WAIT_MS);
  });
}

async function runSearch(query) {
  setState({ query });
  if (!query) return;
  try {
    setState({ products: await searchProducts(query), error: "" });
  } catch (err) {
    setState({ error: err.message });
  }
}
