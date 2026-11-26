// A tiny observable store. The whole UI renders from this one object.

const listeners = new Set();
let state = { products: [], cart: {}, query: "", lastOrder: null, error: "" };

export function getState() {
  return state;
}

export function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
