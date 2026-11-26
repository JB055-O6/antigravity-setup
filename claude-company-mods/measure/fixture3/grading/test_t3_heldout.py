"""Held-out T3 checks. The grader copies this file in after the session."""

from shop.models import Cart, Customer
from shop.money import Money
from shop.pricing.engine import price_cart


def kettles(n):
    cart = Cart()
    cart.add("KET-100", n)
    return cart


def test_exempt_customer_pays_no_tax():
    p = price_cart(kettles(1), Customer("c9", "Ada", "73301", tax_exempt=True))
    assert (p.subtotal, p.discount, p.tax, p.total) == (Money(49_00), Money(0), Money(0), Money(49_00))


def test_default_customer_still_pays_tax():
    p = price_cart(kettles(1), Customer("c9", "Ada", "73301"))
    assert p.tax == Money(3_98)


def test_existing_fields_keep_their_order():
    c = Customer("c1", "Bo", "10001", "gold")
    assert (c.id, c.name, c.postcode, c.tier, c.tax_exempt) == ("c1", "Bo", "10001", "gold", False)


def test_exempt_keeps_the_discount():
    p = price_cart(kettles(2), Customer("c2", "Cy", "94107", "gold", True))
    assert (p.subtotal, p.discount, p.tax, p.total) == (Money(98_00), Money(9_80), Money(0), Money(88_20))
