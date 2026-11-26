// Boot: wire routes, header and search, then load the catalog.

import { renderCheckout, renderDone } from "./checkout.js";
import { renderHeader } from "./components/header.js";
import { loadProducts, renderProducts } from "./products.js";
import { route, start } from "./router.js";
import { bindSearch } from "./search.js";
import { subscribe } from "./state.js";

const root = document.getElementById("app");
const header = document.getElementById("header");
renderHeader(header);
bindSearch(document.getElementById("search"));

route("/", renderProducts);
route("/checkout", renderCheckout);
route("/done", renderDone);

const redraw = start(root);
subscribe(() => {
  renderHeader(header);
  redraw();
});
loadProducts();
