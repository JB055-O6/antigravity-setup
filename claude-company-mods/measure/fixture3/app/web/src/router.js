// Hash router: "#/" products, "#/checkout", "#/done".

const routes = new Map();

export function route(path, render) {
  routes.set(path, render);
}

export function currentPath() {
  return location.hash.replace(/^#/, "") || "/";
}

export function start(root) {
  const draw = () => (routes.get(currentPath()) || routes.get("/"))(root);
  window.addEventListener("hashchange", draw);
  draw();
  return draw;
}
