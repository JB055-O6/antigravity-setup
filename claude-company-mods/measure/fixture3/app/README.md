# Tea shop

A small shop service: product catalog, cart pricing with discounts and
sales tax, orders, and card payments through an external gateway. The
web UI in `web/` is plain ES modules with no build step.

## Run

    make run        # API on http://localhost:8080
    make docker     # nginx and the app with docker compose
    make test       # pytest

The app needs Python 3.11 or newer and nothing else at runtime.

## Layout

- `shop/catalog/` products, search, stock
- `shop/pricing/` discounts, tax, cart pricing
- `shop/geo/` postcode to tax zone
- `shop/orders/` placing orders, API summaries
- `shop/payments/` gateway client and circuit breaker
- `shop/web/` WSGI app and HTTP handlers
- `web/` browser UI

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SHOP_DATA` | `data/shop.json` | where orders are flushed |
| `SHOP_GATEWAY_URL` | gateway URL | card gateway endpoint |
| `SHOP_PAYMENT_TIMEOUT_MS` | `30000` | gateway timeout |
| `SHOP_BREAKER_FAILURES` | `5` | failures before the breaker opens |
| `SHOP_BREAKER_RESET_S` | `30` | seconds before the breaker lets calls through again |

## Discounts

Gold members get 10% off when the subtotal is $50.00 or more. Silver
members get 5% off when the subtotal is $75.00 or more. Coupons:
`WELCOME5` takes $5.00 off, `SPRING15` takes 15% off. Only the larger
discount applies; discounts never stack. Tax is charged on the
subtotal after the discount.
