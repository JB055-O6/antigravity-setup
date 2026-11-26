"""HTTP handlers. Each returns (status, JSON-ready body)."""

import json
import logging
from urllib.parse import parse_qs

from shop.catalog.inventory import Inventory, OutOfStock
from shop.catalog.products import UnknownProduct, all_products
from shop.catalog.search import search
from shop.geo.zones import UnknownPostcode
from shop.models import Cart, Customer
from shop.orders.service import CheckoutFailed, place_order
from shop.orders.summary import order_summary
from shop.payments.gateway import Gateway
from shop.pricing.discounts import UnknownCoupon
from shop.storage import Store

log = logging.getLogger("shop.web")

STORE = Store()
INVENTORY = Inventory({"TEA-001": 40, "TEA-002": 25, "MUG-010": 12, "KET-100": 5, "SET-200": 8})
GATEWAY = Gateway()


def _product_json(p):
    return {"sku": p.sku, "name": p.name, "price": str(p.price), "tags": list(p.tags)}


def _read_json(environ):
    size = int(environ.get("CONTENT_LENGTH") or 0)
    return json.loads(environ["wsgi.input"].read(size) or b"{}")


def list_products(environ):
    return 200, [_product_json(p) for p in all_products()]


def search_products(environ):
    q = parse_qs(environ.get("QUERY_STRING", "")).get("q", [""])[0]
    return 200, [_product_json(p) for p in search(q)]


def handle_checkout(environ):
    body = _read_json(environ)
    cart = Cart()
    for item in body.get("items", []):
        cart.add(item["sku"], int(item.get("qty", 1)))
    if not cart.lines:
        return 400, {"error": "cart is empty"}
    c = body.get("customer", {})
    customer = Customer(c.get("id", "guest"), c.get("name", ""), c.get("postcode", ""), c.get("tier", "standard"))
    try:
        order = place_order(cart, customer, store=STORE, inventory=INVENTORY, gateway=GATEWAY, coupon=body.get("coupon"))
    except (UnknownProduct, UnknownCoupon, UnknownPostcode) as exc:
        return 400, {"error": f"{type(exc).__name__}: {exc}"}
    except OutOfStock as exc:
        return 409, {"error": str(exc)}
    except CheckoutFailed as exc:
        cause = exc.__cause__
        log.exception("checkout failed: %s: %s", type(cause).__name__, cause)
        return 502, {"error": str(exc)}
    return 201, order_summary(order)


def get_summary(environ, order_id):
    order = STORE.get(order_id)
    if order is None:
        return 404, {"error": f"no order {order_id}"}
    return 200, order_summary(order)


def health(environ):
    return 200, {"ok": True}
