"""Place an order: reserve stock, price the cart, charge the card, save."""

from shop.models import Order
from shop.payments.errors import PaymentError
from shop.pricing.engine import price_cart


class CheckoutFailed(Exception):
    pass


def place_order(cart, customer, *, store, inventory, gateway, coupon=None):
    if not cart.lines:
        raise CheckoutFailed("cart is empty")
    inventory.reserve(cart.lines)
    try:
        price = price_cart(cart, customer, coupon)
        order = Order(store.new_id(), customer.id, list(cart.lines), price)
        order.charge_id = gateway.charge(order.id, price.total)
    except PaymentError as exc:
        inventory.release(cart.lines)
        raise CheckoutFailed(f"payment failed: {exc}") from exc
    except Exception:
        inventory.release(cart.lines)
        raise
    order.status = "paid"
    store.save(order)
    return order
