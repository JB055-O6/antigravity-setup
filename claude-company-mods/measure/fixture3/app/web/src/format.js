// Display helpers. The API sends amounts as strings like "18.57".

const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatMoney(text) {
  const cents = Math.round(Number(text) * 100);
  return CURRENCY.format(cents / 100);
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
