// Thin wrapper over fetch for the shop API. Every call returns parsed JSON.

const BASE = window.SHOP_API_BASE || "";

export class ApiError extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function getProducts() {
  return request("GET", "/api/products");
}

export function searchProducts(query) {
  return request("GET", "/api/search?q=" + encodeURIComponent(query));
}

export async function submitOrder(order) {
  return request("POST", "/api/checkout", order);
}

export function getSummary(orderId) {
  return request("GET", `/api/orders/${encodeURIComponent(orderId)}/summary`);
}
