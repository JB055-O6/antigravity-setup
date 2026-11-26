"""Held-out T2 checks. The grader copies this file in after the session."""

from shop.models import Cart, Customer
from shop.money import Money
from shop.pricing.discounts import loyalty_discount
from shop.pricing.engine import price_cart


def test_every_tier_minimum_qualifies():
    assert loyalty_discount(Money(50_00), "gold") == Money(5_00)
    assert loyalty_discount(Money(75_00), "silver") == Money(3_75)


def test_one_cent_below_minimum_does_not():
    assert loyalty_discount(Money(49_99), "gold") == Money(0)
    assert loyalty_discount(Money(74_99), "silver") == Money(0)


def test_above_minimum_still_applies():
    assert loyalty_discount(Money(50_01), "gold") == Money(5_00)
    assert loyalty_discount(Money(120_00), "silver") == Money(6_00)


def test_silver_at_minimum_through_price_cart():
    cart = Cart()
    cart.add("SET-200", 3)
    p = price_cart(cart, Customer("c7", "Di", "30301", "silver"))
    assert (p.subtotal, p.discount, p.tax) == (Money(75_00), Money(3_75), Money(4_99))
